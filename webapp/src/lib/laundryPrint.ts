import QRCode from "qrcode";
import JsBarcode from "jsbarcode";
import { lndryBrand } from "@/assets/generated/manifest";
import { formatINR } from "@/lib/utils";

export type PrintTag = {
  unitId?: string;
  containerId?: string;
  tagKind?: "garment" | "container";
  tagNumber: string;
  tagPayload?: string;
  orderNumber: string;
  customer: string;
  customerPhone?: string;
  invoiceNumber?: string;
  garment: string;
  service: string;
  sequence: number;
  lineSequence?: number;
  total: number;
  orderDate: string;
  expectedDeliveryDate: string;
  notes?: string;
  express?: boolean;
  specialCare?: boolean;
  state?: string;
};

export type PrintOrder = {
  id: string;
  orderNumber: string;
  invoiceNumber?: string;
  customer: { name: string; phone?: string };
  fulfillmentMode?: string;
  expectedDeliveryDate: string;
  receipt: {
    items: Array<{
      garmentName: string;
      serviceName: string;
      qty: number;
      amount: number;
    }>;
    subtotal: number;
    charges: number;
    discounts: number;
    taxAmount: number;
    grandTotal: number;
    paymentMode?: string;
    paymentStatus?: string;
  };
};

export type PrintSettings = {
  businessName?: string;
  address?: string;
  phone?: string;
  email?: string;
  logoDataUrl?: string;
  printerProfile?: string;
  afterBooking?: "ask" | "open-print-centre" | "auto-print" | "none";
  tagTemplate?: {
    preset?: string;
    widthMm?: number;
    heightMm?: number;
    columns?: number;
    rows?: number;
    orientation?: "portrait" | "landscape";
    pageSize?: "A4" | "thermal";
    marginMm?: number;
    fontScale?: number;
    lineSpacing?: number;
    codeFormat?: "qr" | "code128" | "qr+code128";
    showLogo?: boolean;
    showGarment?: boolean;
    showService?: boolean;
    showInvoiceNumber?: boolean;
    showPhone?: boolean;
    showOrderDate?: boolean;
    showTagCode?: boolean;
    showStoreName?: boolean;
    showCustomer?: boolean;
    showOrder?: boolean;
    showDueDate?: boolean;
    showSequence?: boolean;
    showNotes?: boolean;
    showExpress?: boolean;
    showSpecialCare?: boolean;
  };
};
export type PrintCorrection = {
  id: string;
  orderId: string;
  garmentUnitId: string;
  decision: string;
  customerMessage: string;
  issuedAt: string;
};

const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] || char,
  );

async function imageDataUrl(source: string) {
  if (source.startsWith("data:image/")) return source;
  try {
    const response = await fetch(source);
    if (!response.ok) return "";
    const blob = await response.blob();
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => resolve("");
      reader.readAsDataURL(blob);
    });
  } catch {
    return "";
  }
}

export async function buildLaundryPrintHtml(
  kind: "receipt" | "tags",
  order: PrintOrder,
  settings?: PrintSettings,
  requestedTags?: PrintTag[],
) {
  const businessName = settings?.businessName?.trim() || "Epic Laundry";
  const logo = await imageDataUrl(
    settings?.logoDataUrl?.startsWith("data:image/")
      ? settings.logoDataUrl
      : lndryBrand.mark,
  );
  const logoMarkup = settings?.tagTemplate?.showLogo === false ? "" : logo
    ? `<img src="${logo}" alt="${escapeHtml(businessName)}" class="brand-mark">`
    : `<span class="brand-fallback">EL</span>`;
  const contact = [settings?.address, settings?.phone, settings?.email]
    .filter(Boolean)
    .map(escapeHtml)
    .join(" · ");
  const header = `<header>${logoMarkup}<div>${settings?.tagTemplate?.showStoreName !== false ? `<strong>${escapeHtml(businessName)}</strong>` : ""}<small>Local laundry operating desk</small>${contact ? `<small>${contact}</small>` : ""}</div></header>`;
  if (kind === "receipt") {
    const body = `${header}<div class="eyebrow">Customer receipt</div><h1>${escapeHtml(order.invoiceNumber || order.orderNumber)}</h1><p class="muted">${escapeHtml(order.customer.name)}${order.customer.phone ? ` · ${escapeHtml(order.customer.phone)}` : ""} · Due ${escapeHtml(order.expectedDeliveryDate)}</p><div class="line-items">${order.receipt.items.map((item) => `<div><span>${escapeHtml(item.garmentName)} <small>${escapeHtml(item.serviceName)} · ${item.qty}</small></span><strong>${formatINR(item.amount)}</strong></div>`).join("")}</div><div class="totals"><div><span>Subtotal</span><span>${formatINR(order.receipt.subtotal)}</span></div><div><span>Adjustments</span><span>${formatINR(order.receipt.charges - order.receipt.discounts + order.receipt.taxAmount)}</span></div><div class="grand"><span>Total</span><strong>${formatINR(order.receipt.grandTotal)}</strong></div></div><p class="muted">${escapeHtml(order.receipt.paymentStatus || "")} · ${escapeHtml(order.receipt.paymentMode || "")}</p>`;
    return documentHtml("Customer receipt", body, "receipt-page");
  }
  const tags = requestedTags || [];
  const template = settings?.tagTemplate;
  const codeFormat = template?.codeFormat || "qr";
  const showQr = codeFormat === "qr" || codeFormat === "qr+code128";
  const showBarcode = codeFormat === "code128" || codeFormat === "qr+code128";
  const renderedTags = await Promise.all(
    tags.map(async (tag) => {
      const payload = tag.tagPayload || `ELT:v1:${tag.tagNumber}`;
      const qr = showQr
        ? await QRCode.toDataURL(payload, {
            width: 180,
            margin: 1,
            errorCorrectionLevel: "M",
            color: { dark: "#123039", light: "#ffffff" },
          }).catch(() => "")
        : "";
      let barcode = "";
      if (showBarcode) {
        const svg = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "svg",
        );
        try {
          JsBarcode(svg, tag.tagNumber, {
            format: "CODE128",
            displayValue: true,
            width: 1.2,
            height: 28,
            margin: 0,
            fontSize: 8,
            lineColor: "#123039",
          });
          barcode = svg.outerHTML;
        } catch {
          barcode = "";
        }
      }
      const details = [
        template?.showOrder !== false
          ? `<div class="order">${escapeHtml(tag.orderNumber)}</div>`
          : "",
        template?.showInvoiceNumber
          ? `<div class="order">Invoice ${escapeHtml(tag.invoiceNumber || "")}</div>`
          : "",
        template?.showCustomer !== false
          ? `<div class="order">${escapeHtml(tag.customer)}</div>`
          : "",
        template?.showPhone
          ? `<div class="order">${escapeHtml(tag.customerPhone || "")}</div>`
          : "",
        template?.showOrderDate
          ? `<div class="order">Booked ${escapeHtml(tag.orderDate)}</div>`
          : "",
        template?.showDueDate !== false
          ? `<div class="due">DUE ${escapeHtml(tag.expectedDeliveryDate)}</div>`
          : "",
        template?.showNotes && tag.notes
          ? `<div class="order">${escapeHtml(tag.notes)}</div>`
          : "",
        template?.showExpress && tag.express
          ? `<div class="due">EXPRESS</div>`
          : "",
        template?.showSpecialCare && tag.specialCare
          ? `<div class="due">SPECIAL CARE</div>`
          : "",
      ].join("");
      const footerCode =
        template?.showTagCode !== false
          ? `<span>${escapeHtml(tag.tagNumber)}</span>`
          : "<span></span>";
      return `<article class="tag"><div class="tag-head"><span class="brand-mini">${template?.showStoreName !== false ? "EPIC LAUNDRY" : "LAUNDRY"}${tag.tagKind === "container" ? " · CONTAINER" : ""}</span>${template?.showSequence !== false ? `<span class="sequence">${tag.sequence} / ${tag.total}</span>` : ""}</div><div class="tag-main"><div>${template?.showGarment !== false ? `<div class="garment">${escapeHtml(tag.garment)}</div>` : ""}${template?.showService !== false ? `<div class="service">${escapeHtml(tag.service)}</div>` : ""}${details}</div>${qr ? `<img class="qr" src="${qr}" alt="Opaque tag QR">` : ""}</div>${barcode ? `<div class="barcode">${barcode}</div>` : ""}<div class="tag-foot">${footerCode}<span>${tag.state ? escapeHtml(tag.state) : "INTAKE"}</span></div></article>`;
    }),
  );
  const containerOnly =
    tags.length > 0 && tags.every((tag) => tag.tagKind === "container");
  const tagLabel = containerOnly ? "Container tags" : "Garment tags";
  const body = `${header}<div class="eyebrow">${tagLabel} · ${tags.length} selected</div><h1>${escapeHtml(order.orderNumber)}</h1><p class="muted">${escapeHtml(order.customer.name)} · due ${escapeHtml(order.expectedDeliveryDate)} · order-wide sequence</p><main class="tags">${renderedTags.join("")}</main>`;
  const widthMm = Number(template?.widthMm) || 96;
  const heightMm = Number(template?.heightMm) || 84;
  const columns = Math.max(1, Math.min(6, Number(template?.columns) || 2));
  const rows = Math.max(1, Math.min(12, Number(template?.rows) || 3));
  const pageSize =
    template?.pageSize === "thermal" || template?.preset?.startsWith("thermal")
      ? `${widthMm}mm ${heightMm}mm`
      : "A4";
  const marginMm = Number(template?.marginMm) || 8;
  const fontScale = Number(template?.fontScale) || 1;
  const lineSpacing = Number(template?.lineSpacing) || 1;
  const orientation =
    template?.orientation === "landscape" ? "landscape" : "portrait";
  return documentHtml(
    tagLabel,
    body,
    "tag-page",
    `@page{size:${pageSize} ${pageSize === "A4" ? orientation : ""};margin:${marginMm}mm}.tags{grid-template-columns:repeat(${columns},1fr);grid-template-rows:repeat(${rows},auto)}.tag{height:${heightMm}mm;font-size:${fontScale}em;line-height:${lineSpacing}}.barcode svg{width:100%;height:auto;max-height:13mm}`,
  );
}

export async function buildLaundryCorrectionPrintHtml(
  correction: PrintCorrection,
  settings?: PrintSettings,
) {
  const businessName = settings?.businessName?.trim() || "Epic Laundry";
  const logo = await imageDataUrl(
    settings?.logoDataUrl?.startsWith("data:image/")
      ? settings.logoDataUrl
      : lndryBrand.mark,
  );
  const logoMarkup = logo
    ? `<img src="${logo}" alt="${escapeHtml(businessName)}" class="brand-mark">`
    : `<span class="brand-fallback">EL</span>`;
  const body = `<header>${logoMarkup}<div><strong>${escapeHtml(businessName)}</strong><small>Customer quality correction</small></div></header><div class="eyebrow">Customer care document</div><h1>${escapeHtml(correction.decision)} resolution</h1><div class="line-items"><div><span>Document</span><strong>${escapeHtml(correction.id)}</strong></div><div><span>Order</span><strong>${escapeHtml(correction.orderId)}</strong></div><div><span>Garment unit</span><strong>${escapeHtml(correction.garmentUnitId)}</strong></div><div><span>Issued</span><strong>${escapeHtml(new Date(correction.issuedAt).toLocaleString("en-IN"))}</strong></div></div><blockquote>${escapeHtml(correction.customerMessage)}</blockquote><p class="muted">This printed copy is a customer-safe communication. The original quality claim remains immutable in the Epic Laundry audit trail.</p>`;
  return documentHtml("Customer correction", body, "correction-page");
}

function documentHtml(
  title: string,
  body: string,
  pageClass: string,
  extraCss = "",
) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)} · Epic Laundry</title><style>
    @page{size:A4;margin:8mm}*{box-sizing:border-box}body{font-family:"Segoe UI",Arial,sans-serif;color:#17353c;margin:0;background:#fff}.${pageClass}{max-width:194mm;margin:0 auto;padding:2mm}.eyebrow{margin-top:8mm;color:#3a7d78;font-size:9px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}h1{font-size:23px;line-height:1.1;margin:3mm 0 1.5mm}.muted{color:#718087;font-size:11px;margin:0}header{display:flex;align-items:center;gap:10px;border-bottom:1px solid #c7d7d0;padding-bottom:4mm}header strong{display:block;font-size:20px;letter-spacing:-.02em}header small{display:block;color:#718087;font-size:9px;margin-top:2px}.brand-mark,.brand-fallback{width:34px;height:34px;object-fit:contain}.brand-fallback{display:grid;place-items:center;border-radius:9px;background:#123039;color:#f2c66d;font-weight:900}.line-items{margin-top:9mm;border-top:1px solid #d8e2dd}.line-items>div,.totals>div{display:flex;justify-content:space-between;gap:12px;padding:3mm 0;border-bottom:1px solid #e8eeeb;font-size:12px}.line-items small{display:block;color:#718087;font-size:10px;margin-top:1px}.totals{margin-top:6mm}.totals .grand{border-top:1.5px solid #123039;border-bottom:0;font-size:16px;padding-top:4mm}.tags{display:grid;grid-template-columns:repeat(2,1fr);gap:5mm;margin-top:7mm}.tag{height:84mm;border:1.2px dashed #78998f;border-radius:4mm;padding:5mm;display:flex;flex-direction:column;justify-content:space-between;break-inside:avoid;background:#fff}.tag-head,.tag-foot{display:flex;justify-content:space-between;gap:4mm;align-items:center}.brand-mini{font-size:9px;font-weight:900;letter-spacing:.12em;color:#39786f}.sequence{font-size:14px;font-weight:900;color:#123039}.tag-main{display:flex;align-items:center;justify-content:space-between;gap:3mm}.garment{font-size:17px;font-weight:800;line-height:1.12;max-width:45mm;overflow-wrap:anywhere}.service{font-size:11px;color:#39786f;margin-top:2mm}.order{font-size:10px;color:#617178;margin-top:4mm}.due{font-size:10px;font-weight:800;color:#855815;margin-top:2mm}.qr{width:25mm;height:25mm;image-rendering:pixelated}.tag-foot{border-top:1px solid #e4ebe6;padding-top:3mm;color:#617178;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:8px}.tag-foot span:last-child{font-family:"Segoe UI",Arial,sans-serif;font-weight:800;letter-spacing:.08em}blockquote{margin:10mm 0;padding:5mm;border-left:1.5mm solid #e6bc65;background:#f7faf7;line-height:1.6;font-size:14px}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}${extraCss}
  </style></head><body><div class="${pageClass}">${body}</div></body></html>`;
}
