import mongoose from "mongoose";
import { z } from "zod";
import { ROLES } from "./permissions.js";

// Request shapes for the pharmacy API (see lib/validate.js). Text is trimmed and
// limited in length; anything not listed is dropped.
const name = z.string().trim().min(1, "Enter a name").max(80);
const phone = z.string().trim().max(30);
const password = z.string().min(8, "At least 8 characters").max(100);

export const objectId = z.string().refine((value) => mongoose.isValidObjectId(value), "Not found");
export const idParam = z.object({ id: objectId });

export const createStaffSchema = z.object({
  name,
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(120),
  password,
  phone: phone.default(""),
  role: z.enum(ROLES, { errorMap: () => ({ message: "Choose manager or cashier" }) }),
});

export const updateStaffSchema = z
  .object({
    name: name.optional(),
    phone: phone.optional(),
    role: z.enum(ROLES, { errorMap: () => ({ message: "Choose manager or cashier" }) }).optional(),
    active: z.boolean().optional(),
    password: password.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Nothing to change");
