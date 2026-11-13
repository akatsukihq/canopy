"use client";

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from "react";
import type { InvoiceData } from "@/lib/paperwork/types";
import type { InvoiceTemplate } from "@/lib/invoice-templates/index.ts";
import { calculateInvoiceTotals, formatCurrency } from "@/lib/paperwork/utils/calculations";
import { getFontGoogleLink, resolveTemplateStyles } from "@/lib/invoice-templates/index.ts";
import { Landmark, ArrowRight, ShieldCheck } from "lucide-react";

interface InvoicePreviewRendererProps {
  data: InvoiceData;
  template: InvoiceTemplate;
  sampleType?: string; // used for testing preview states
  isPrintMode?: boolean;
}

export default function InvoicePreviewRenderer({ data, template, isPrintMode = false }: InvoicePreviewRendererProps) {
  const totals = calculateInvoiceTotals(data);
  const { config, layoutFamily } = template;
  const {
    theme,
    typography,
    page,
    header,
    businessBlock,
    clientBlock,
    metaBlock,
    lineItemsTable,
    totalsBlock,
    paymentBlock,
    notesBlock,
    footer,
    watermark,
    labels,
    visibility,
  } = config;

  // Resolve specific styling classes & rules
  const styles = resolveTemplateStyles(config);

  // Dynamic Google Font Loader
  useEffect(() => {
    const importUrl = getFontGoogleLink(typography.fontFamily);
    if (!importUrl) return;

    // Check if link already exists
    const existingLink = document.getElementById(`font-${typography.fontFamily}`);
    if (existingLink) return;

    const link = document.createElement("link");
    link.id = `font-${typography.fontFamily}`;
    link.rel = "stylesheet";
    link.href = importUrl;
    document.head.appendChild(link);
  }, [typography.fontFamily]);

  // Clean strings
  const getMethodText = () => {
    const list: string[] = [];
    const methods = data.payment.methods || [];
    if (methods.includes("bank")) list.push("Bank Wire");
    if (methods.includes("check")) list.push("Business Check");
    if (methods.includes("paypal")) list.push("PayPal");
    if (methods.includes("venmo")) list.push("Venmo");
    if (methods.includes("zelle")) list.push("Zelle Transact");
    if (methods.includes("card")) list.push("Credit Card");
    if (methods.includes("cash")) list.push("Cash Deposit");
    return list.join(", ");
  };

  const hasBizContact = !!data.business.contactName && businessBlock.showContactName;
  const hasBizTaxId = !!data.business.taxId && businessBlock.showTaxId;
  const hasBizEmail = !!data.business.email && businessBlock.showEmail;
  const hasBizPhone = !!data.business.phone && businessBlock.showPhone;
  const hasBizWeb = !!data.business.website && businessBlock.showWebsite;
  const hasBizAddr = !!data.business.addressLine1 && businessBlock.showAddress;

  const hasClientCompany = !!data.client.company && clientBlock.showCompany;
  const hasClientEmail = !!data.client.email && clientBlock.showEmail;
  const hasClientPhone = !!data.client.phone && clientBlock.showPhone;
  const hasClientAddr = !!data.client.addressLine1 && clientBlock.showAddress;

  const hasPoNumber = !!data.invoice.poNumber && metaBlock.showPoNumber;
  const hasProjectName = !!data.invoice.projectName && metaBlock.showProjectName;
  const hasInvoiceDate = !!data.invoice.invoiceDate && metaBlock.showInvoiceDate;
  const hasDueDate = !!data.invoice.dueDate && metaBlock.showDueDate;
  const hasPaymentTerms = !!data.invoice.paymentTerms && metaBlock.showPaymentTerms;

  // Font size config
  const headingSizeClass =
    typography.headingSize === "sm"
      ? "text-lg"
      : typography.headingSize === "lg"
        ? "text-2xl"
        : typography.headingSize === "xl"
          ? "text-3xl lg:text-4xl"
          : "text-xl md:text-2xl";

  const logoSizePixels = header.logoSize === "sm" ? "h-10" : header.logoSize === "lg" ? "h-16" : "h-12";

  return (
    <div
      className={`bg-white text-slate-900 shadow-md ${page.showPageBorder ? "border-2" : "border"} relative w-full select-none print:shadow-none print:border-0 print:p-0 print:m-0 flex flex-col justify-between`}
      id="invoice-print-area"
      style={{
        ...styles.rootStyle,
        borderColor: page.showPageBorder ? theme.primaryColor : theme.borderColor,
        minHeight: "297mm",
        padding: page.margin === "compact" ? "1.2rem" : page.margin === "spacious" ? "3rem" : "2.2rem",
        backgroundColor: theme.surfaceColor,
      }}
    >
      {/* Dynamic Watermark overlay */}
      {watermark.enabled && (
        <div
          className={`absolute pointer-events-none z-0 flex items-center justify-center select-none uppercase font-black text-center ${
            watermark.position === "center"
              ? "inset-0 text-7xl md:text-8xl rotate-45"
              : "bottom-8 right-8 text-2xl md:text-3xl opacity-50"
          }`}
          style={{
            color: theme.primaryColor,
            opacity: watermark.opacity,
            fontFamily: watermark.position === "bottom-right" ? "monospace" : undefined,
          }}
        >
          {watermark.text}
        </div>
      )}

      {/* Styled top decorative line */}
      {!isPrintMode && layoutFamily !== "minimal" && (
        <div className="h-2 absolute top-0 left-0 right-0 rounded-t" style={styles.primaryBg} />
      )}

      <div className="space-y-6 relative z-10 flex-1">
        {/* ================= HEADER SECTION ================= */}
        {visibility.showFooter && (
          <div className="flex flex-col gap-4">
            {/* Header Layout: bold (colored band) */}
            {layoutFamily === "bold" && (
              <div className="p-6 -mx-9 -mt-9 text-white space-y-4 mb-4 font-sans" style={styles.primaryBg}>
                <div className="flex justify-between items-center">
                  {visibility.showLogo && data.business.logo ? (
                    <img
                      src={data.business.logo}
                      alt="Logo"
                      className={`${logoSizePixels} w-auto object-contain brightness-105`}
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="font-extrabold tracking-tight text-lg">★ {data.business.name}</span>
                  )}
                  {header.showInvoiceTitle && (
                    <span className="text-xl font-bold tracking-widest uppercase">
                      {labels.invoiceTitle || "INVOICE"}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4 text-xs pt-2 border-t border-white/20">
                  <div>
                    <h4 className="font-bold uppercase tracking-wider text-white/70 text-[10px]">{labels.from}</h4>
                    <p className="font-bold text-sm">{data.business.name}</p>
                    {hasBizContact && <p>{data.business.contactName}</p>}
                    {hasBizEmail && <p>{data.business.email}</p>}
                  </div>
                  <div className="text-right">
                    <p className="font-bold font-mono">#{data.invoice.invoiceNumber || "INV-1"}</p>
                    {hasInvoiceDate && <p>Date: {data.invoice.invoiceDate}</p>}
                    {hasDueDate && <p className="font-semibold text-rose-200">Due: {data.invoice.dueDate}</p>}
                  </div>
                </div>
              </div>
            )}

            {/* Standard Headers: classic, modern, compact, minimal, service */}
            {layoutFamily !== "bold" && (
              <div
                className={`flex flex-col sm:flex-row justify-between items-start gap-4 pb-4 ${
                  layoutFamily === "classic" ? "border-b-2" : "border-b"
                }`}
                style={{ borderColor: theme.borderColor }}
              >
                {/* Brand & Logo block */}
                <div className="space-y-2">
                  {visibility.showLogo && data.business.logo ? (
                    <div className="flex items-center mb-1">
                      <img
                        src={data.business.logo}
                        alt="Logo"
                        className={`${logoSizePixels} w-auto object-contain`}
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  ) : null}

                  {businessBlock.showBusinessName && (
                    <p className={`font-black tracking-tight ${headingSizeClass}`} style={styles.primaryColorText}>
                      {data.business.name || "[Business Name]"}
                    </p>
                  )}

                  {/* Seller Contacts */}
                  {layoutFamily !== "compact" && (
                    <div className="text-xs space-y-0.5" style={styles.mutedText}>
                      {hasBizContact && <p className="font-semibold text-slate-800">{data.business.contactName}</p>}
                      {hasBizAddr && (
                        <p>
                          {data.business.addressLine1}
                          {data.business.addressLine2 ? `, ${data.business.addressLine2}` : ""}
                        </p>
                      )}
                      {(data.business.city || data.business.state || data.business.zipCode) && (
                        <p>
                          {data.business.city || ""}, {data.business.state || ""} {data.business.zipCode || ""}
                        </p>
                      )}
                      {hasBizEmail && <p>{data.business.email}</p>}
                      {hasBizPhone && <p>{data.business.phone}</p>}
                      {hasBizWeb && <p className="font-semibold">{data.business.website}</p>}
                      {hasBizTaxId && <p className="font-mono text-[10px]">Tax ID: {data.business.taxId}</p>}
                    </div>
                  )}
                </div>

                {/* Meta details right block */}
                <div className="sm:text-right shrink-0">
                  {header.showInvoiceTitle && (
                    <p
                      className="text-2xl font-black uppercase tracking-wider leading-none mb-1"
                      style={styles.primaryColorText}
                    >
                      {labels.invoiceTitle || "INVOICE"}
                    </p>
                  )}

                  {header.showStatusBadge && (
                    <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 text-[9px] font-extrabold text-emerald-700 uppercase border border-emerald-200">
                      <ShieldCheck className="w-3 h-3 text-emerald-600 fill-emerald-50" />
                      <span>Saved</span>
                    </div>
                  )}

                  <div className="text-xs space-y-1 mt-2 text-slate-700">
                    <p className="font-bold text-slate-900 text-sm">#{data.invoice.invoiceNumber || "INV-YYYY-001"}</p>
                    {hasInvoiceDate && (
                      <p>
                        {labels.invoiceDate || "Issue ID"}:{" "}
                        <span className="font-semibold">{data.invoice.invoiceDate}</span>
                      </p>
                    )}
                    {hasDueDate && (
                      <p>
                        {labels.dueDate || "Due"}:{" "}
                        <span className="font-bold text-slate-900">{data.invoice.dueDate}</span>
                      </p>
                    )}
                    {hasPaymentTerms && (
                      <p>
                        {labels.paymentTerms || "Terms"}:{" "}
                        <span className="font-semibold">{data.invoice.paymentTerms}</span>
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================= CLIENT AND RECIPIENT BLOCK ================= */}
        {layoutFamily !== "bold" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2">
            {/* Business Block (Fallback or secondary layout position) */}
            {layoutFamily === "compact" && (
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider block" style={styles.mutedText}>
                  {labels.from || "Seller Details"}
                </span>
                <p className="font-bold text-slate-900 text-sm">{data.business.name}</p>
                {hasBizEmail && <p className="text-xs text-slate-600">{data.business.email}</p>}
                {hasBizPhone && <p className="text-xs text-slate-600">{data.business.phone}</p>}
                {hasBizTaxId && <p className="text-xs font-mono text-slate-500">EIN: {data.business.taxId}</p>}
              </div>
            )}

            {/* Bill To Block */}
            {visibility.showClientBlock && (
              <div
                className={`${
                  layoutFamily === "modern" || layoutFamily === "service"
                    ? "bg-slate-50 border border-slate-100 p-4 rounded-xl"
                    : "space-y-1"
                }`}
                style={
                  layoutFamily === "classic"
                    ? { borderLeft: `3px solid ${theme.primaryColor}`, paddingLeft: "12px" }
                    : undefined
                }
              >
                <span className="text-[10px] font-bold uppercase tracking-widest block" style={styles.mutedText}>
                  {labels.billTo || "Billed To"}
                </span>
                <p className="font-extrabold text-slate-900 text-sm">{data.client.name || "[Client Name]"}</p>
                {hasClientCompany && <p className="text-xs font-semibold text-slate-700">{data.client.company}</p>}
                {hasClientAddr && (
                  <p className="text-xs text-slate-600">
                    {data.client.addressLine1}
                    {data.client.addressLine2 ? `, ${data.client.addressLine2}` : ""}
                  </p>
                )}
                {(data.client.city || data.client.state || data.client.zipCode) && (
                  <p className="text-xs text-slate-600">
                    {data.client.city || ""}, {data.client.state || ""} {data.client.zipCode || ""}
                  </p>
                )}
                <div className="text-xs text-slate-500 space-y-0.5 pt-1">
                  {hasClientEmail && <p>{data.client.email}</p>}
                  {hasClientPhone && <p>{data.client.phone}</p>}
                </div>
              </div>
            )}

            {/* Project / Metadata blocks */}
            {(hasProjectName || hasPoNumber) && (
              <div className="flex flex-col justify-center space-y-2">
                <div className="bg-slate-50 border border-slate-150 p-3 rounded-lg space-y-1.5 text-xs">
                  {hasProjectName && (
                    <div>
                      <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">
                        {labels.projectName || "Project"}
                      </span>
                      <p className="font-bold text-slate-800">{data.invoice.projectName}</p>
                    </div>
                  )}
                  {hasPoNumber && (
                    <div>
                      <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">
                        {labels.poNumber || "P.O. Number"}
                      </span>
                      <p className="font-bold text-slate-800 font-mono">{data.invoice.poNumber}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================= LINE ITEMS TABLE ================= */}
        {visibility.showLineItems && (
          <div className="pt-2">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr
                  className={`border-b-2 font-bold ${
                    lineItemsTable.headerBackground ? "text-white" : "text-slate-500"
                  }`}
                  style={styles.tableHeaderBg}
                >
                  <th className="py-2.5 px-2 font-bold text-[10px] uppercase tracking-wider text-left">
                    {lineItemsTable.descriptionLabel || labels.notes || "Description / Task Deliverables"}
                  </th>
                  <th className="py-2.5 font-bold text-[10px] uppercase tracking-wider text-center w-16">
                    {lineItemsTable.quantityLabel || "Qty"}
                  </th>
                  <th className="py-2.5 font-bold text-[10px] uppercase tracking-wider text-right w-24">
                    {lineItemsTable.rateLabel || "Price"}
                  </th>
                  <th className="py-2.5 px-2 font-bold text-[10px] uppercase tracking-wider text-right w-24">
                    {lineItemsTable.amountLabel || "Sum"}
                  </th>
                </tr>
              </thead>
              <tbody
                className={`divide-y text-slate-800 ${
                  lineItemsTable.style === "striped" ? "divide-slate-100" : "divide-slate-200"
                }`}
                style={{ borderColor: theme.borderColor }}
              >
                {data.lineItems && data.lineItems.length > 0 ? (
                  data.lineItems.map((item, idx) => {
                    const qty = Number(item.quantity) || 0;
                    const price = Number(item.unitPrice) || 0;
                    const amount = qty * price;
                    const rowBgStyle =
                      lineItemsTable.style === "striped" && idx % 2 === 1
                        ? { backgroundColor: theme.backgroundColor }
                        : undefined;

                    return (
                      <tr
                        key={item.id || idx}
                        style={rowBgStyle}
                        className={`${lineItemsTable.style === "bordered" ? "border" : "hover:bg-slate-50/20"}`}
                      >
                        <td className="py-3 px-2 max-w-sm align-top leading-relaxed">
                          <p className="font-semibold text-slate-900">
                            {item.description || "[Deliverable item name]"}
                          </p>
                          {item.taxable && lineItemsTable.showTaxableColumn && (
                            <span
                              className="inline-block mt-1 font-mono text-[8px] px-1 py-0.2 rounded border"
                              style={{
                                borderColor: theme.borderColor,
                                color: theme.mutedTextColor,
                                backgroundColor: theme.backgroundColor,
                              }}
                            >
                              Taxable
                            </span>
                          )}
                        </td>
                        <td className="py-3 text-center font-mono align-top text-slate-600">{qty}</td>
                        <td className="py-3 text-right font-mono align-top text-slate-600">
                          {formatCurrency(price, data.invoice.currency || "USD")}
                        </td>
                        <td className="py-3 px-2 text-right font-mono font-bold align-top text-slate-900">
                          {formatCurrency(amount, data.invoice.currency || "USD")}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-400 italic font-medium">
                      Add items in the editor pane to preview invoice totals.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ================= SUMMARY FIELDS AND INSTRUCTIONS ================= */}
        {visibility.showTotals && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 pt-4 border-t border-slate-100">
            {/* Pay Instructions (Left span) */}
            <div className="md:col-span-6 space-y-4">
              {visibility.showPaymentInstructions && data.payment.instructions && (
                <div className="space-y-1">
                  <h4
                    className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5"
                    style={styles.mutedText}
                  >
                    <Landmark className="w-3.5 h-3.5" />
                    <span>{paymentBlock.title || "Payment Instructions"}</span>
                  </h4>
                  <div
                    className="text-[11px] leading-relaxed whitespace-pre-wrap p-3 rounded-lg border text-slate-600"
                    style={{
                      borderColor: theme.borderColor,
                      backgroundColor: paymentBlock.style === "muted" ? theme.backgroundColor : undefined,
                    }}
                  >
                    {data.payment.instructions}
                    {paymentBlock.showPaymentMethods && getMethodText() && (
                      <div className="mt-2 pt-2 border-t border-dashed border-slate-200 text-[10px] font-semibold text-slate-500">
                        Methods Accepted: {getMethodText()}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Financial Calculations (Right span) */}
            <div className="md:col-span-6 space-y-2 text-xs text-slate-600 font-medium">
              {totalsBlock.showSubtotal && (
                <div className="flex justify-between font-medium">
                  <span style={styles.mutedText}>{labels.subtotal || "Subtotal"}:</span>
                  <span className="font-mono text-slate-900 text-right">
                    {formatCurrency(totals.subtotal, data.invoice.currency || "USD")}
                  </span>
                </div>
              )}

              {totalsBlock.showDiscount && totals.discountAmount > 0 && (
                <div className="flex justify-between text-emerald-600">
                  <span>
                    {labels.discount || "Discount"}{" "}
                    {data.totalsConfig.discountType === "percent" ? `(${data.totalsConfig.discountValue}%)` : ""}:
                  </span>
                  <span className="font-mono text-right">
                    - {formatCurrency(totals.discountAmount, data.invoice.currency || "USD")}
                  </span>
                </div>
              )}

              {totalsBlock.showTax && totals.taxAmount > 0 && (
                <div className="flex justify-between">
                  <span className="truncate" style={styles.mutedText}>
                    {data.totalsConfig.taxLabel || labels.tax || "Sales Tax"} ({data.totalsConfig.taxRate}%):
                  </span>
                  <span className="font-mono text-slate-900 text-right">
                    {formatCurrency(totals.taxAmount, data.invoice.currency || "USD")}
                  </span>
                </div>
              )}

              {totalsBlock.showShipping && totals.shippingFee > 0 && (
                <div className="flex justify-between">
                  <span style={styles.mutedText}>{labels.shipping || "Shipping"}:</span>
                  <span className="font-mono text-slate-900 text-right">
                    {formatCurrency(totals.shippingFee, data.invoice.currency || "USD")}
                  </span>
                </div>
              )}

              <div
                className="flex justify-between border-t pt-2 font-bold text-[13px] text-slate-900"
                style={{ borderColor: theme.borderColor }}
              >
                <span>{labels.total || "Total Due"}:</span>
                <span className="font-mono text-right">
                  {formatCurrency(totals.total, data.invoice.currency || "USD")}
                </span>
              </div>

              {totalsBlock.showAmountPaid && totals.amountPaid > 0 && (
                <div className="flex justify-between text-slate-500">
                  <span>{labels.amountPaid || "Amount Paid"}:</span>
                  <span className="font-mono text-right">
                    - {formatCurrency(totals.amountPaid, data.invoice.currency || "USD")}
                  </span>
                </div>
              )}

              {/* Dynamic balance due highlight style */}
              {totalsBlock.showBalanceDue && (
                <div
                  className={`flex justify-between items-center rounded-lg p-3 mt-1 shadow-xs transition-colors duration-150 ${
                    totalsBlock.style === "highlight-total" ? "text-white select-none" : "border"
                  }`}
                  style={
                    totalsBlock.style === "highlight-total"
                      ? { backgroundColor: theme.primaryColor }
                      : { borderColor: theme.primaryColor, backgroundColor: theme.backgroundColor }
                  }
                >
                  <span
                    className={`font-bold text-xs ${totalsBlock.style === "highlight-total" ? "text-white" : "text-slate-900"}`}
                  >
                    {totals.customerCredit > 0 ? "Customer credit" : labels.balanceDue || "Balance Due"}:
                  </span>
                  <span
                    className="font-mono text-lg font-black text-right"
                    style={{
                      color: totalsBlock.style === "highlight-total" ? theme.surfaceColor : theme.primaryColor,
                    }}
                  >
                    {formatCurrency(
                      totals.customerCredit > 0 ? totals.customerCredit : totals.balanceDue,
                      data.invoice.currency || "USD",
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================= NOTES, TERMS, SIGS ================= */}
        <div className="space-y-4 pt-4 border-t border-slate-100 text-[11px] text-slate-500">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {visibility.showNotes && data.notes.notes && (
              <div className="space-y-1">
                <span className="font-bold text-slate-700 block">{labels.notes || "Notes & Details"}:</span>
                <p
                  className="p-2.5 rounded border text-slate-600 leading-relaxed"
                  style={{
                    borderColor: theme.borderColor,
                    backgroundColor: notesBlock.style === "muted" ? theme.backgroundColor : undefined,
                  }}
                >
                  {data.notes.notes}
                </p>
              </div>
            )}
            {visibility.showTerms && data.notes.terms && (
              <div className="space-y-1">
                <span className="font-bold text-slate-700 block">{labels.terms || "Terms & Arrangements"}:</span>
                <p
                  className="p-2.5 rounded border text-slate-600 leading-relaxed"
                  style={{
                    borderColor: theme.borderColor,
                    backgroundColor: notesBlock.style === "muted" ? theme.backgroundColor : undefined,
                  }}
                >
                  {data.notes.terms}
                </p>
              </div>
            )}
          </div>

          {/* Late fees warnings and signature greetings */}
          {(data.payment.lateFeeNote || data.payment.thankYouNote) && (
            <div className="flex flex-col sm:flex-row justify-between items-start gap-2 pt-2 border-t border-dashed border-slate-100">
              <div>
                {paymentBlock.showLateFeeNote && data.payment.lateFeeNote && (
                  <p className="font-mono text-[10px] text-rose-600 font-semibold">
                    * Late Fee Notice: {data.payment.lateFeeNote}
                  </p>
                )}
              </div>
              <div className="sm:text-right">
                {notesBlock.showThankYouNote && data.payment.thankYouNote && (
                  <p className="font-extrabold text-slate-800 italic">{data.payment.thankYouNote}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ================= FOOTER BANNER ================= */}
      {visibility.showFooter && footer.showFooter && (
        <div
          className="pt-6 mt-12 border-t flex flex-col sm:flex-row justify-between items-center text-[10px] text-slate-400 font-medium"
          style={{ borderColor: theme.borderColor }}
        >
          <span>Saved & Generated via PaperworkKit</span>
          <p className="text-center italic my-1 sm:my-0">{footer.text || "Thank you for your cooperation!"}</p>
          {footer.showGeneratedWith && (
            <span className="font-bold uppercase tracking-wider text-slate-400">US-Focused PDF Draft</span>
          )}
        </div>
      )}
    </div>
  );
}
