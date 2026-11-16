import { smsMessages as smsMessagesTable } from "../../schema/sms-messages";
import { defineSlice } from "../slice";

// One sent text and one failed one, so the admin log shows both states. The failed row's
// error echoes a code, which the screen shows masked. `user_id` stays null: the slice must
// not depend on `auth`'s seed users.

export const smsMessages = defineSlice(smsMessagesTable, {
  rows: {
    failed: {
      error: 'provider refused "482913 is your verification code"',
      provider: "console",
      purpose: "sign_up",
      status: "failed",
      template: "verification-code",
      toPhone: "+15555550101",
    },
    sent: {
      provider: "console",
      providerRef: "console-1",
      purpose: "sign_up",
      status: "sent",
      template: "verification-code",
      toPhone: "+15555550100",
    },
  },
});
