export interface ConversationHeadingContext {
  readonly vehicle?:
    { readonly make: string | null; readonly model: string | null } | null | undefined;
}

export function conversationHeading(context?: ConversationHeadingContext): string {
  const make = context?.vehicle?.make?.trim();
  const model = context?.vehicle?.model?.trim();
  return [make, model].filter(Boolean).join(' ') || 'Booking conversation';
}
