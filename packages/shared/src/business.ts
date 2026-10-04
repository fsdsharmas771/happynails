/**
 * The business behind the brand (owner-confirmed, 2026-10-04). Used on invoices, the footer and
 * contact links. Registered office from the company's MCA record (CIN below).
 */
export const BUSINESS = {
  brand: "Happy Nails",
  byline: "by Anamika",
  legalName: "Haritash and Vasistha (OPC) Private Limited",
  cin: "U47912UP2024OPC200021",
  gstin: "09AAHCH2761F1ZK",
  address: {
    lines: ["H.No. 227, Moh. Husainpura", "Jansath, Muzaffarnagar"],
    state: "Uttar Pradesh",
    pincode: "251314",
  },
  /** GST state code; the first two digits of the GSTIN. */
  stateCode: "09",
  phoneDisplay: "+91 87002 75273",
  /** E.164 without the plus, as WhatsApp links and the Cloud API expect. */
  whatsappNumber: "918700275273",
} as const;

/** GST state codes for the states a supply can be made to. */
export const GST_STATE_CODES: Record<string, string> = {
  "Jammu and Kashmir": "01",
  "Himachal Pradesh": "02",
  Punjab: "03",
  Chandigarh: "04",
  Uttarakhand: "05",
  Haryana: "06",
  Delhi: "07",
  Rajasthan: "08",
  "Uttar Pradesh": "09",
  Bihar: "10",
  Sikkim: "11",
  "Arunachal Pradesh": "12",
  Nagaland: "13",
  Manipur: "14",
  Mizoram: "15",
  Tripura: "16",
  Meghalaya: "17",
  Assam: "18",
  "West Bengal": "19",
  Jharkhand: "20",
  Odisha: "21",
  Chhattisgarh: "22",
  "Madhya Pradesh": "23",
  Gujarat: "24",
  "Dadra and Nagar Haveli and Daman and Diu": "26",
  Maharashtra: "27",
  Karnataka: "29",
  Goa: "30",
  Lakshadweep: "31",
  Kerala: "32",
  "Tamil Nadu": "33",
  Puducherry: "34",
  "Andaman and Nicobar Islands": "35",
  Telangana: "36",
  "Andhra Pradesh": "37",
  Ladakh: "38",
};
