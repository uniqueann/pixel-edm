import { z } from "zod";
import { mailingAddressProblemCode } from "./mailing-address";
export const workspaceSettings = z.object({
  name: z
    .string()
    .trim()
    .min(1, "validation.workspaceNameRequired")
    .max(80, "validation.workspaceNameTooLong"),
  mailing_address: z
    .string()
    .trim()
    .max(500, "validation.mailingAddressTooLong")
    .superRefine((value, ctx) => {
      const problemCode = mailingAddressProblemCode(value);
      if (problemCode)
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: problemCode });
    }),
});
export const credentials = z.object({
  email: z.string().email("validation.emailInvalid"),
  password: z
    .string()
    .min(8, "validation.passwordTooShort")
    .max(128, "validation.passwordTooLong"),
});
