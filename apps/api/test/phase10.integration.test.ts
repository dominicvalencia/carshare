import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_PREFIX } from '@carrental/api-contracts';
import {
  BookingActorType,
  BookingStatus,
  NotificationDeliveryStatus,
  PushTokenStatus,
  RoleCode,
} from '@carrental/database';
import { FakePushProvider } from '@carrental/notifications';
import { AppModule } from '../src/app.module';
import { TokenService } from '../src/auth/token.service';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import {
  consumeDomainEvent,
  deliverPendingNotifications,
  reconcilePushReceipts,
} from '../../workers/src/notification-delivery';

interface Actor {
  readonly userId: string;
  readonly token: string;
}

describe.sequential('Phase 10 communications, reputation, support and notifications', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let tokens: TokenService;
  let renter: Actor;
  let owner: Actor;
  let outsider: Actor;
  let admin: Actor;
  let bookingId = '';
  let bookingReference = '';
  let vehicleId = '';
  let ownerProfileId = '';
  let conversationId = '';
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ bufferLogs: true });
    app.use(cookieParser());
    app.useLogger(app.get(Logger));
    app.setGlobalPrefix(API_PREFIX);
    app.useGlobalPipes(
      new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }),
    );
    await app.init();
    database = app.get(DatabaseService);
    tokens = app.get(TokenService);
    renter = await actor('renter', [RoleCode.RENTER]);
    owner = await actor('owner', [RoleCode.RENTER, RoleCode.OWNER]);
    outsider = await actor('outsider', [RoleCode.RENTER]);
    admin = await actor('admin', [RoleCode.ADMIN]);
    ownerProfileId = (
      await database.client.ownerProfile.create({
        data: {
          userId: owner.userId,
          status: 'VERIFIED',
          legalName: 'Phase Ten Owner',
          verifiedAt: new Date(),
        },
      })
    ).id;
    vehicleId = (
      await database.client.vehicle.create({
        data: {
          ownerUserId: owner.userId,
          ownerProfileId,
          make: 'PhaseTen',
          model: 'Comms',
          modelYear: 2026,
          status: 'APPROVED',
        },
      })
    ).id;
    const policy = await database.client.vehiclePolicyVersion.create({
      data: {
        vehicleId,
        version: 1,
        createdByUserId: owner.userId,
        dailyRateMinor: 100_000,
        minimumRentalDays: 1,
        maximumRentalDays: 30,
        mileagePolicy: 'UNLIMITED',
        turnaroundMinutes: 120,
      },
    });
    const start = new Date(Date.now() + 86_400_000);
    const end = new Date(start.getTime() + 86_400_000);
    const quote = await database.client.pricingQuote.create({
      data: {
        renterUserId: renter.userId,
        vehicleId,
        policyVersionId: policy.id,
        rentalStart: start,
        rentalEnd: end,
        vehicleTimezone: 'Asia/Manila',
        chargeableDays: 1,
        currency: 'PHP',
        subtotalMinor: 100_000,
        totalMinor: 100_000,
        unlimitedMileage: true,
        turnaroundMinutes: 120,
        pricingEngineVersion: 'PHASE10_TEST',
        expiresAt: new Date(Date.now() + 900_000),
      },
    });
    bookingReference = `P10-${unique}`.slice(0, 32);
    const booking = await database.client.booking.create({
      data: {
        publicReference: bookingReference,
        renterUserId: renter.userId,
        ownerUserId: owner.userId,
        ownerProfileId,
        vehicleId,
        quoteId: quote.id,
        status: BookingStatus.COMPLETED,
        rentalStart: start,
        rentalEnd: end,
      },
    });
    bookingId = booking.id;
    await database.client.bookingStatusHistory.create({
      data: {
        bookingId,
        toStatus: BookingStatus.COMPLETED,
        actorType: BookingActorType.SYSTEM,
        reasonCode: 'PHASE10_TEST_COMPLETED',
      },
    });
    conversationId = (
      await database.client.conversation.findUniqueOrThrow({ where: { bookingId } })
    ).id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('creates exactly one booking conversation and enforces participant privacy', async () => {
    expect(await database.client.conversation.count({ where: { bookingId } })).toBe(1);
    expect(await database.client.conversationParticipant.count({ where: { conversationId } })).toBe(
      2,
    );
    await auth(
      request(app.getHttpServer()).get(`/api/v1/conversations/${conversationId}`),
      outsider,
    ).expect(404);
    await auth(
      request(app.getHttpServer()).get(`/api/v1/conversations/${conversationId}`),
      renter,
    ).expect(200);
  });

  it('sends immutable messages idempotently and tracks read state', async () => {
    const key = `phase10-message-${unique}`;
    const calls = await Promise.all(
      Array.from({ length: 8 }, () =>
        auth(
          request(app.getHttpServer()).post(`/api/v1/conversations/${conversationId}/messages`),
          renter,
        )
          .set('Idempotency-Key', key)
          .send({ body: 'Pickup instructions, without private contact details.' }),
      ),
    );
    expect(calls.every((response) => response.status === 201)).toBe(true);
    const first = calls[0]!;
    expect(new Set(calls.map((response) => response.body.data.id)).size).toBe(1);
    expect(
      await database.client.message.count({
        where: { conversationId, senderUserId: renter.userId, idempotencyKey: key },
      }),
    ).toBe(1);
    await expect(
      database.client.message.update({
        where: { id: first.body.data.id },
        data: { body: 'silently edited' },
      }),
    ).rejects.toThrow();
    await auth(
      request(app.getHttpServer()).post(`/api/v1/conversations/${conversationId}/read`),
      owner,
    )
      .send({ messageId: first.body.data.id })
      .expect(201);
    expect(
      (
        await database.client.conversationParticipant.findUniqueOrThrow({
          where: { conversationId_userId: { conversationId, userId: owner.userId } },
        })
      ).lastReadMessageId,
    ).toBe(first.body.data.id);
  });

  it('converges duplicate events to one in-app notification and reconciles fake push', async () => {
    await auth(request(app.getHttpServer()).post('/api/v1/push-tokens'), owner)
      .send({ provider: 'FAKE', platform: 'IOS', token: `fake-valid-${unique}` })
      .expect(201);
    const sourceId = randomUUID();
    const payload = { recipientUserId: owner.userId, messageId: sourceId, conversationId };
    await consumeDomainEvent(database.client, 'NEW_MESSAGE', payload, randomUUID());
    await consumeDomainEvent(database.client, 'NEW_MESSAGE', payload, randomUUID());
    const notification = await database.client.notification.findFirstOrThrow({
      where: { userId: owner.userId, sourceId },
    });
    expect(
      await database.client.notification.count({ where: { userId: owner.userId, sourceId } }),
    ).toBe(1);
    const provider = new FakePushProvider();
    expect(await deliverPendingNotifications(database.client, provider)).toBeGreaterThan(0);
    await reconcilePushReceipts(database.client, provider, 0);
    expect(
      (
        await database.client.notificationDelivery.findFirstOrThrow({
          where: { notificationId: notification.id },
        })
      ).status,
    ).toBe(NotificationDeliveryStatus.DELIVERED);
    const inbox = await auth(
      request(app.getHttpServer()).get('/api/v1/notifications/summary'),
      owner,
    ).expect(200);
    expect(inbox.body.data.unreadCount).toBeGreaterThan(0);
  });

  it('permanently disables provider-invalid tokens without exposing them in notification APIs', async () => {
    const registration = await auth(
      request(app.getHttpServer()).post('/api/v1/push-tokens'),
      renter,
    )
      .send({ provider: 'FAKE', platform: 'ANDROID', token: `invalid-${unique}` })
      .expect(201);
    await consumeDomainEvent(
      database.client,
      'NEW_MESSAGE',
      { recipientUserId: renter.userId, messageId: randomUUID(), conversationId },
      randomUUID(),
    );
    await deliverPendingNotifications(database.client, new FakePushProvider());
    expect(
      (
        await database.client.devicePushToken.findUniqueOrThrow({
          where: { id: registration.body.data.id },
        })
      ).status,
    ).toBe(PushTokenStatus.DISABLED);
    expect(
      JSON.stringify(
        (await auth(request(app.getHttpServer()).get('/api/v1/notifications'), renter)).body,
      ),
    ).not.toContain(`invalid-${unique}`);
  });

  it('allows one review per booking/author/type under concurrency and recalculates moderated aggregates', async () => {
    const calls = await Promise.all(
      Array.from({ length: 8 }, () =>
        auth(
          request(app.getHttpServer()).post(`/api/v1/bookings/${bookingReference}/reviews`),
          renter,
        ).send({
          type: 'VEHICLE',
          rating: 5,
          categoryRatings: { condition: 5, value: 5 },
          text: 'Accurate vehicle and smooth rental.',
        }),
      ),
    );
    expect(calls.filter((response) => response.status === 201)).toHaveLength(1);
    expect(calls.filter((response) => response.status === 409)).toHaveLength(7);
    const review = await database.client.review.findFirstOrThrow({
      where: { bookingId, authorUserId: renter.userId, type: 'VEHICLE' },
    });
    expect(
      (
        await database.client.ratingProjection.findUniqueOrThrow({
          where: { subjectType_subjectId: { subjectType: 'VEHICLE', subjectId: vehicleId } },
        })
      ).reviewCount,
    ).toBe(1);
    await auth(request(app.getHttpServer()).post('/api/v1/reports'), outsider)
      .send({
        targetType: 'REVIEW',
        targetId: review.id,
        reason: 'Requesting an administrator review.',
      })
      .expect(201);
    await auth(
      request(app.getHttpServer()).post(`/api/v1/admin/reviews/${review.id}/moderation`),
      admin,
    )
      .send({ status: 'HIDDEN', reason: 'Hidden for Phase 10 moderation verification.' })
      .expect(201);
    expect(
      (
        await database.client.ratingProjection.findUniqueOrThrow({
          where: { subjectType_subjectId: { subjectType: 'VEHICLE', subjectId: vehicleId } },
        })
      ).reviewCount,
    ).toBe(0);
  });

  it('keeps support tickets private and internal notes invisible to users', async () => {
    const created = await auth(request(app.getHttpServer()).post('/api/v1/support/tickets'), renter)
      .set('Idempotency-Key', `support-create-${unique}`)
      .send({
        category: 'BOOKING',
        subject: 'Help with completed booking',
        message: 'Please clarify the completion record.',
        bookingId,
      })
      .expect(201);
    const reference = created.body.data.publicReference as string;
    await auth(
      request(app.getHttpServer()).get(`/api/v1/support/tickets/${reference}`),
      outsider,
    ).expect(404);
    await auth(
      request(app.getHttpServer()).post(`/api/v1/admin/support/tickets/${reference}/messages`),
      admin,
    )
      .set('Idempotency-Key', `internal-${unique}`)
      .send({ body: 'Private investigation note.', visibility: 'INTERNAL' })
      .expect(201);
    await auth(
      request(app.getHttpServer()).post(`/api/v1/admin/support/tickets/${reference}/messages`),
      admin,
    )
      .set('Idempotency-Key', `reply-${unique}`)
      .send({ body: 'We reviewed your booking.', visibility: 'USER_VISIBLE' })
      .expect(201);
    const detail = await auth(
      request(app.getHttpServer()).get(`/api/v1/support/tickets/${reference}`),
      renter,
    ).expect(200);
    expect(JSON.stringify(detail.body)).toContain('We reviewed your booking.');
    expect(JSON.stringify(detail.body)).not.toContain('Private investigation note.');
    await auth(
      request(app.getHttpServer()).patch(`/api/v1/admin/support/tickets/${reference}`),
      admin,
    )
      .send({ status: 'RESOLVED', reason: 'Question answered.' })
      .expect(200);
  });

  async function actor(label: string, roles: readonly RoleCode[]): Promise<Actor> {
    const rows = await database.client.role.findMany({ where: { code: { in: [...roles] } } });
    const userId = randomUUID();
    const sessionId = randomUUID();
    await database.client.user.create({
      data: {
        id: userId,
        email: `${label}-${unique}@example.test`,
        normalizedEmail: `${label}-${unique}@example.test`,
        roles: { create: rows.map(({ id }) => ({ roleId: id })) },
        sessions: {
          create: { id: sessionId, expiresAt: new Date(Date.now() + 86_400_000), platform: 'WEB' },
        },
      },
    });
    return { userId, token: await tokens.signAccessToken(userId, sessionId, roles) };
  }
  function auth<T extends request.Test>(operation: T, actorValue: Actor): T {
    return operation.set('Authorization', `Bearer ${actorValue.token}`) as T;
  }
});
