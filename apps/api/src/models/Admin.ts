import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";

export const ADMIN_ROLES = ["owner", "staff"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

const adminUserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, default: "" },
    /** argon2id. */
    passwordHash: { type: String, required: true },
    role: { type: String, required: true, enum: ADMIN_ROLES },
    active: { type: Boolean, default: true },
    /** Bumped to sign out every session at once (password change, removal). */
    tokenVersion: { type: Number, default: 0 },
    lastLoginAt: Date,
  },
  { timestamps: true },
);
export type AdminUserDoc = HydratedDocument<InferSchemaType<typeof adminUserSchema>>;
export const AdminUser = model("AdminUser", adminUserSchema);

/** Real client testimonials. Only published ones are shown; the site never invents reviews. */
const testimonialSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    city: { type: String, default: "" },
    setName: { type: String, default: "" },
    quote: { type: String, default: "" },
    videoUrl: { type: String, default: "" },
    posterUrl: { type: String, default: "" },
    published: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);
export const Testimonial = model("Testimonial", testimonialSchema);
