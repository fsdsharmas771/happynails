import { z } from "zod";

export const NAIL_SHAPES = ["almond", "coffin", "square", "oval", "stiletto"] as const;
export const NAIL_FINISHES = [
  "gloss",
  "matte",
  "ombre",
  "chrome",
  "cateye",
  "french",
  "glitter",
  "art",
] as const;

export const nailShapeSchema = z.enum(NAIL_SHAPES);
export const nailFinishSchema = z.enum(NAIL_FINISHES);
/** Six-digit hex colour, e.g. "#D49C8B". NailArt mixes these numerically, so shorthand is not accepted. */
export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected a colour like #D49C8B");

export type NailShape = z.infer<typeof nailShapeSchema>;
export type NailFinish = z.infer<typeof nailFinishSchema>;

export const FINISH_LABELS: Record<NailFinish, string> = {
  gloss: "Gloss",
  matte: "Matte",
  ombre: "Ombre",
  chrome: "Chrome",
  cateye: "Cat-eye",
  french: "French",
  glitter: "Glitter",
  art: "Line art",
};
