import { defineColumnClasses } from "../column-class";
import { smsMessages as smsMessagesTable } from "../schema/sms-messages";

// How the production read-only role reads `sms_messages`. See `../column-class.ts`.

export const smsMessages = defineColumnClasses(smsMessagesTable, {
  createdAt: "plain",
  // The provider's error text, which can echo the one-time code the message carried.
  error: "secret",
  id: "plain",
  provider: "plain",
  providerRef: "plain",
  purpose: "plain",
  status: "plain",
  template: "plain",
  // The phone number the message went to.
  toPhone: "pii",
  userId: "plain",
});
