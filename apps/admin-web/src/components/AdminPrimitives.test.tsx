import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminErrorDialog, AdminEvidenceCard, StatusBadge, statusTone } from './AdminPrimitives';

afterEach(cleanup);

describe('StatusBadge', () => {
  it.each([undefined, null, ''])('renders a safe fallback for %s', (value) => {
    expect(renderToStaticMarkup(<StatusBadge value={value} />)).toContain('Not available');
  });

  it('renders an unknown value without throwing', () => {
    expect(renderToStaticMarkup(<StatusBadge value="NEW_PROVIDER_STATE" />)).toContain(
      'New provider state',
    );
  });

  it('uses the known operator-facing mapping', () => {
    expect(renderToStaticMarkup(<StatusBadge value="RETURN_PENDING" />)).toContain(
      'Return awaiting confirmation',
    );
  });

  it('centralizes semantic status families and keeps unknown values neutral', () => {
    expect(statusTone('READY_FOR_PICKUP')).toBe('info');
    expect(statusTone('PENDING_REVIEW')).toBe('warning');
    expect(statusTone('ACTIVE')).toBe('success');
    expect(statusTone('REJECTED')).toBe('danger');
    expect(statusTone('PROVIDER_SPECIFIC_VALUE')).toBe('neutral');
  });
});

describe('AdminErrorDialog', () => {
  it('presents the reason in a modal and supports Escape dismissal', () => {
    const onClose = vi.fn();
    render(
      <AdminErrorDialog
        message="Save reviewer notes before approval."
        onClose={onClose}
        title="Verification action could not be completed"
      />,
    );
    expect(
      screen.getByRole('alertdialog', { name: 'Verification action could not be completed' }),
    ).not.toBeNull();
    expect(screen.getByText('Save reviewer notes before approval.')).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('AdminEvidenceCard', () => {
  it('requests access only after interaction and renders an authorized image inline', async () => {
    const requestAccess = vi.fn().mockResolvedValue({
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      mimeType: 'image/jpeg',
      url: 'http://api.test/file-access/photo?grant=signed',
    });
    render(<AdminEvidenceCard label="Driver side" requestAccess={requestAccess} />);
    expect(requestAccess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Load secure preview' }));
    const image = await screen.findByRole('img', { name: 'Driver side secure preview' });
    fireEvent.load(image);
    expect(requestAccess).toHaveBeenCalledTimes(1);
    expect(image.getAttribute('src')).toBe('http://api.test/file-access/photo?grant=signed');
  });

  it('applies explicit photo-cover and document-contain display modes', () => {
    const access = vi.fn();
    const { container, rerender } = render(
      <AdminEvidenceCard displayMode="photo" label="Pickup photo" requestAccess={access} />,
    );
    expect(container.querySelector('.evidence-mode-photo')).not.toBeNull();
    rerender(<AdminEvidenceCard label="License document" requestAccess={access} />);
    expect(container.querySelector('.evidence-mode-document')).not.toBeNull();
  });

  it('keeps secure media dimensions stable and defines both scaling modes', () => {
    const styles = readFileSync('src/app/styles.css', 'utf8');
    expect(styles).toContain('aspect-ratio: 16 / 9');
    expect(styles).toContain('.evidence-mode-photo .evidence-preview img');
    expect(styles).toContain('object-fit: cover');
    expect(styles).toContain('object-fit: contain');
    expect(styles).toContain('overflow: hidden');
    expect(styles).toContain('.evidence-image-button');
    expect(styles).toContain('position: absolute');
    expect(styles).toContain('inset: 0');
  });

  it('does not render a PDF as an image', async () => {
    render(
      <AdminEvidenceCard
        label="Registration"
        requestAccess={vi.fn().mockResolvedValue({
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          mimeType: 'application/pdf',
          url: 'http://api.test/file-access/document?grant=signed',
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Load secure preview' }));
    expect(await screen.findByText(/This evidence is a PDF/)).not.toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows a retry action after grant failure', async () => {
    const requestAccess = vi.fn().mockRejectedValue(new Error('expired'));
    render(<AdminEvidenceCard label="Return photo" requestAccess={requestAccess} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load secure preview' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Retry secure preview' })).not.toBeNull(),
    );
  });

  it('opens the loaded image in a keyboard-dismissible lightbox without requesting a new grant', async () => {
    const requestAccess = vi.fn().mockResolvedValue({
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      mimeType: 'image/png',
      url: 'http://api.test/file-access/license?grant=signed',
    });
    render(<AdminEvidenceCard label="License front" requestAccess={requestAccess} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load secure preview' }));
    const image = await screen.findByRole('img', { name: 'License front secure preview' });
    fireEvent.load(image);
    fireEvent.click(screen.getByRole('button', { name: 'View License front full size' }));
    expect(screen.getByRole('dialog', { name: 'License front evidence viewer' })).not.toBeNull();
    expect(requestAccess).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Reload secure evidence' }));
    await waitFor(() => expect(requestAccess).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'View License front full size' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
