import { Schema, model, type InferSchemaType } from "mongoose";

const int = { validator: Number.isInteger, message: "{PATH} must be an integer" };
const paise = { type: Number, required: true, validate: int } as const;

const lineSchema = new Schema(
  {
    description: { type: String, required: true },
    hsnSac: { type: String, required: true },
    qty: { type: Number, required: true, validate: int },
    ratePct: { type: Number, required: true },
    taxablePaise: paise,
    cgstPaise: paise,
    sgstPaise: paise,
    igstPaise: paise,
    totalPaise: paise,
  },
  { _id: false },
);

/** GST tax invoices and credit notes. Written once; never edited. */
const invoiceSchema = new Schema(
  {
    /** HN/26-27/00001 for invoices, HNCN/26-27/00001 for credit notes. */
    number: { type: String, required: true, unique: true },
    kind: { type: String, required: true, enum: ["invoice", "credit_note"] },
    againstNumber: String,
    issuedAt: { type: Date, required: true },
    source: {
      type: new Schema(
        {
          type: { type: String, required: true, enum: ["order", "booking"] },
          id: { type: Schema.Types.ObjectId, required: true },
          number: { type: String, required: true },
          /** For credit notes: the Razorpay refund this documents. */
          refundId: String,
        },
        { _id: false },
      ),
      required: true,
    },
    supplier: {
      type: new Schema(
        {
          legalName: String,
          brand: String,
          gstin: String,
          cin: String,
          address: String,
          state: String,
          stateCode: String,
        },
        { _id: false },
      ),
      required: true,
    },
    customer: {
      type: new Schema(
        { name: String, phone: String, email: String, address: String, state: String },
        { _id: false },
      ),
      required: true,
    },
    placeOfSupply: { type: new Schema({ state: String, code: String }, { _id: false }), required: true },
    intraState: { type: Boolean, required: true },
    lines: { type: [lineSchema], required: true },
    totals: {
      type: new Schema(
        { taxablePaise: paise, cgstPaise: paise, sgstPaise: paise, igstPaise: paise, totalPaise: paise },
        { _id: false },
      ),
      required: true,
    },
    paymentNote: { type: String, default: "" },
  },
  { timestamps: true },
);

// One tax invoice per order or booking, and one credit note per refund: issuing is idempotent.
invoiceSchema.index(
  { "source.type": 1, "source.id": 1 },
  { unique: true, partialFilterExpression: { kind: "invoice" } },
);
invoiceSchema.index(
  { "source.refundId": 1 },
  { unique: true, partialFilterExpression: { kind: "credit_note" } },
);
invoiceSchema.index({ issuedAt: 1 });

export type InvoiceAttrs = InferSchemaType<typeof invoiceSchema>;
export const Invoice = model("Invoice", invoiceSchema);
