import type {
  BookingStatus,
  NailFinish,
  NailShape,
  Occasion,
  OrderStatus,
  VisitCity,
} from "@happynails/shared";

/** Shapes of the admin API responses (Mongo documents as JSON). */

export interface Product {
  _id: string;
  slug: string;
  name: string;
  description: string;
  shape: NailShape;
  finish: NailFinish;
  occasion: Occasion;
  color: string;
  color2?: string;
  pricePaise: number;
  stock: number;
  images: { url: string; alt: string }[];
  active: boolean;
  sortOrder: number;
}

interface Event<S> {
  status: S;
  at: string;
  note?: string;
}

interface Refund {
  razorpayRefundId: string;
  amountPaise: number;
  reason?: string;
  at: string;
}

export interface Order {
  _id: string;
  number: string;
  status: OrderStatus;
  customer: { name: string; phone: string; email: string };
  address: { line: string; pincode: string; city: string; state: string };
  items: { slug: string; name: string; optionLabel: string; unitPaise: number; qty: number }[];
  subtotalPaise: number;
  shippingPaise: number;
  totalPaise: number;
  shippingSpeed: "standard" | "express";
  payment: {
    status: string;
    razorpayOrderId?: string;
    razorpayPaymentId?: string;
    paidAt?: string;
    failureReason?: string;
  };
  stockState: string;
  tracking?: { carrier?: string; awb?: string; url?: string };
  refunds: Refund[];
  events: Event<OrderStatus>[];
  createdAt: string;
}

export interface OrderList {
  items: Pick<Order, "_id" | "number" | "status" | "customer" | "totalPaise" | "payment" | "createdAt">[];
  total: number;
  page: number;
  pages: number;
}

export interface Booking {
  _id: string;
  number: string;
  status: BookingStatus;
  customer: { name: string; phone: string };
  city: VisitCity;
  pincode: string;
  address: string;
  serviceName: string;
  addons: { name: string; pricePaise: number; minutes: number }[];
  totalPaise: number;
  minutes: number;
  technicianId: string;
  startsAt: string;
  endsAt: string;
  notes: string;
  payment: { method: "online" | "after_visit"; status: string; paidAt?: string };
  refunds: Refund[];
  events: Event<BookingStatus>[];
}

export interface Technician {
  _id: string;
  name: string;
  phone: string;
  cities: VisitCity[];
  active: boolean;
  week: { weekday: number; slotTimes: string[] }[];
  blocks: { _id: string; fromDate: string; toDate: string; reason: string }[];
}

export interface Offering {
  _id: string;
  name: string;
  description: string;
  minutes: number;
  pricePaise: number;
  active: boolean;
  sortOrder: number;
  unitNote?: string;
}

export interface Testimonial {
  _id: string;
  name: string;
  city: string;
  setName: string;
  quote: string;
  videoUrl: string;
  posterUrl: string;
  published: boolean;
  sortOrder: number;
}

export interface Dashboard {
  today: string;
  visits: {
    id: string;
    number: string;
    startsAt: string;
    city: VisitCity;
    serviceName: string;
    customerName: string;
    technician: string;
    status: BookingStatus;
    paymentStatus: string;
  }[];
  ordersToPack: {
    count: number;
    oldest: {
      _id: string;
      number: string;
      customer: { name: string };
      totalPaise: number;
      createdAt: string;
    }[];
  };
  revenueThisMonthPaise: number;
  needsRefund: number;
}
