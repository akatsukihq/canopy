"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ComponentType, type FormEvent, type ReactNode } from "react";
import { localizeHref, type Locale } from "@/lib/i18n/config";
import { ArrowUpRight, Eye, Grid, PenLine, Printer, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import {
  Caption,
  H2,
  H3,
  Muted,
  P,
  Text,
  AccountNavigation,
  AccountNavigationProps,
  AlertBanner,
  AppContainer,
  Button,
  ToolActionButton,
  Card,
  Field,
  Input,
  ToolPageShell,
  Overline,
  StatusBadge,
  TabsList,
  TabsTrigger,
} from "@/components/ui/index.tsx";
import { CanopyFooter } from "@/components/canopy/CanopyFooter";
import { seedTemplates, type DocumentTemplate } from "@/lib/invoice-templates/index.ts";
import type { ResolvedTool } from "@/lib/tool-catalog/index.ts";
import AdvancedTemplateWorkspace from "./AdvancedTemplateWorkspace";
import { PaperworkMobileTabs, PaperworkWorkspace } from "./PaperworkWorkspace";
import { WorkbenchPanes } from "@/components/tool-workbench/WorkbenchPanes";
import ExpenseReportPage from "./expense/ExpenseReportPage";
import InvoiceForm from "./InvoiceForm";
import InvoicePreviewRenderer from "./InvoicePreviewRenderer";
import MileageLogPage from "./mileage/MileageLogPage";
import NecTrackerPage from "./nec1099/NecTrackerPage";
import QuarterlyTaxEstimatorPage from "./tax/QuarterlyTaxEstimatorPage";
import ReceiptGeneratorPage from "./receipt/ReceiptGeneratorPage";
import TemplateSelector from "./TemplateSelector";
import W9RequestPage from "./w9/W9RequestPage";
import { invoiceAdapter } from "@/lib/paperwork/documentAdapters";
import type { InvoiceData } from "@/lib/paperwork/types";
import { validateInvoiceData } from "@/lib/paperwork/utils/invoiceValidation";
import { getInitialBlankInvoice, getSampleInvoice } from "@/lib/paperwork/utils/sampleData";
import { DataBridge, DataBridgeKeys } from "@/lib/paperwork/shared/dataBridge";
import { PaperworkFeedbackProvider, usePaperworkFeedback } from "./PaperworkFeedback";

function trackEvent(eventName: string, payload: Record<string, unknown> = {}) {
  console.log(`[Analytics Event] "${eventName}" tracked:`, payload);
}

const TOOL_COMPONENTS: Record<
  string,
  ComponentType<{
    onTrackClick: (itemName: string) => void;
    templates?: readonly DocumentTemplate[];
    embedded?: boolean;
  }>
> = {
  "expense-report": ExpenseReportPage,
  "mileage-log": MileageLogPage,
  "quarterly-tax-estimator": QuarterlyTaxEstimatorPage,
  "w9-request": W9RequestPage,
  "1099-nec-tracker": NecTrackerPage,
};

type DialogName = "clear" | "sample" | "upgrade";
type AppProps = {
  availableLocales?: readonly Locale[];
  account: AccountNavigationProps;
  componentKey: string;
  templates: readonly DocumentTemplate[];
  tools: readonly (ResolvedTool & { href?: string })[];
};

function AppDialog({
  children,
  labelledBy,
  onClose,
  open,
}: {
  children: ReactNode;
  labelledBy: string;
  onClose: () => void;
  open: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      aria-labelledby={labelledBy}
      className="m-auto w-[calc(100%_-_2rem)] max-w-lg rounded-3xl border border-border bg-card p-0 text-card-foreground shadow-2xl backdrop:bg-foreground/55 backdrop:backdrop-blur-xs"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      ref={dialogRef}
    >
      {/* A closed <dialog> still ships its children in the HTML, so crawlers would read these titles as page headings. */}
      {open ? children : null}
    </dialog>
  );
}

function defaultTemplate(templates: readonly DocumentTemplate[]) {
  const published = templates.filter(
    (template) => template.status === "published" && template.documentType === "invoice",
  );
  const fallback = seedTemplates.filter((template) => template.status === "published");
  const template =
    published.find((candidate) => candidate.isDefault) ??
    published[0] ??
    fallback.find((candidate) => candidate.isDefault) ??
    fallback[0];
  if (!template) throw new Error("A published invoice template is required.");
  return template;
}

export default function App(props: AppProps) {
  return (
    <PaperworkFeedbackProvider>
      <HydratedApp {...props} />
    </PaperworkFeedbackProvider>
  );
}

function HydratedApp(props: AppProps) {
  const [restoration, setRestoration] = useState(() => {
    DataBridge.holdAutomaticSaves();
    return 0;
  });
  const touched = useRef(false);
  useEffect(() => {
    let active = true;
    void DataBridge.whenReady().then(() => {
      // Restoring an untouched form must not displace an edit made during sync.
      if (active && !touched.current) setRestoration(1);
    });
    return () => {
      active = false;
    };
  }, []);
  function beginEdit() {
    touched.current = true;
    DataBridge.beginUserEdit();
  }
  return (
    <div onInputCapture={beginEdit} onChangeCapture={beginEdit} onClickCapture={beginEdit}>
      <AppContent key={restoration} {...props} />
    </div>
  );
}

function restoredInvoice(): InvoiceData {
  return DataBridge.getInvoiceDraft() ?? getInitialBlankInvoice();
}

function AppContent({ availableLocales = ["en"], account, componentKey, templates, tools }: AppProps) {
  const t = useTranslations("Tool.runtime");
  const locale = useLocale() as Locale;
  const common = useTranslations("Common");
  const workbench = useTranslations("Workbench");
  const currentTool = tools.find((tool) => tool.componentKey === componentKey);
  const [edited, setEdited] = useState(false);
  const isInvoice = componentKey === "invoice-generator";
  const isReceipt = componentKey === "receipt-generator";
  const ToolComponent = TOOL_COMPONENTS[componentKey];
  const formSectionRef = useRef<HTMLDivElement>(null);
  const [invoiceData, setInvoiceData] = useState<InvoiceData>(restoredInvoice);
  const [selectedTemplate, setSelectedTemplate] = useState(() => defaultTemplate(templates));
  const [templateSelectionReady, setTemplateSelectionReady] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving">("saved");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pdfAction, setPdfAction] = useState<"download" | "print" | null>(null);
  const [pdfError, setPdfError] = useState("");
  const [activeDialog, setActiveDialog] = useState<DialogName | null>(null);
  const [activeMobileTab, setActiveMobileTab] = useState<"edit" | "preview">("edit");
  const { notify: showToast } = usePaperworkFeedback();
  const [storageStatus, setStorageStatus] = useState({ ready: false, pending: 0, error: null } as ReturnType<
    typeof DataBridge.getStatus
  >);
  useEffect(() => {
    setStorageStatus(DataBridge.getStatus());
    return DataBridge.subscribe(() => setStorageStatus(DataBridge.getStatus()));
  }, []);
  const lastStorageError = useRef<string | null>(null);
  useEffect(() => {
    if (storageStatus.error && storageStatus.error !== lastStorageError.current)
      showToast(t(storageStatus.reloadRequired ? "shared.storage.ownerChanged" : "shared.storage.failed"), "error");
    lastStorageError.current = storageStatus.error;
  }, [storageStatus.error, storageStatus.reloadRequired, showToast, t]);
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistError, setWaitlistError] = useState("");
  useEffect(() => {
    const storedTemplateId = localStorage.getItem(
      DataBridge.scopedLocalKey("paperworkkit.advanced-template.invoice.selected"),
    );
    const storedTemplate = templates.find(
      (template) => template.id === storedTemplateId && template.status === "published",
    );
    if (storedTemplate) setSelectedTemplate(storedTemplate);
    setTemplateSelectionReady(true);
  }, [templates]);

  useEffect(() => {
    if (!templateSelectionReady) return;
    localStorage.setItem(
      DataBridge.scopedLocalKey("paperworkkit.advanced-template.invoice.selected"),
      selectedTemplate.id,
    );
  }, [selectedTemplate.id, templateSelectionReady]);

  useEffect(() => {
    if (!isInvoice) return;
    setSaveStatus("saving");
    const timer = window.setTimeout(() => {
      try {
        DataBridge.set(DataBridgeKeys.INVOICE_DRAFT, invoiceData);
        setSaveStatus("saved");
      } catch (error) {
        console.error("Failed to save the local invoice draft", error);
        setSaveStatus("saved");
        showToast(t("shared.app.saveFailed"), "error");
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [invoiceData, isInvoice]);

  function validateInvoice() {
    const nextErrors = validateInvoiceData(invoiceData, (key) => t(`invoice.validation.${key}`));
    setErrors(nextErrors);
    const errorCount = Object.keys(nextErrors).length;
    if (errorCount) {
      setActiveMobileTab("edit");
      showToast(t("shared.app.reviewFields", { count: errorCount }), "error");
      window.requestAnimationFrame(() => {
        formSectionRef.current?.scrollIntoView({ behavior: "smooth" });
      });
      return false;
    }
    return true;
  }

  async function generateInvoicePdf(action: "download" | "print") {
    if (selectedTemplate.layoutFamily === "advanced") return;
    if (!validateInvoice()) return;

    const printWindow = action === "print" ? window.open("about:blank", "_blank") : null;
    if (action === "print" && !printWindow) {
      setPdfError(t("shared.app.allowPrintablePopups"));
      showToast(t("shared.app.printBlocked"), "error");
      return;
    }
    if (printWindow) printWindow.opener = null;

    setPdfAction(action);
    setPdfError("");
    const invoiceNumber = invoiceData.invoice.invoiceNumber.trim().replace(/[^a-z0-9_-]+/gi, "-");
    const fileName = `invoice-${invoiceNumber || "draft"}.pdf`;

    try {
      const [{ pdf }, { default: InvoicePdfDocument }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./InvoicePdfDocument"),
      ]);
      const blob = await pdf(<InvoicePdfDocument data={invoiceData} template={selectedTemplate} />).toBlob();
      const url = URL.createObjectURL(blob);

      if (action === "print" && printWindow) {
        printWindow.location.href = url;
        trackEvent("invoice_print_clicked");
        showToast(t("shared.app.printOpened"));
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        document.body.append(link);
        link.click();
        link.remove();
        trackEvent("invoice_pdf_downloaded");
        showToast(t("shared.app.downloaded"));
      }

      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      printWindow?.close();
      console.error("Failed to generate the invoice PDF", error);
      setPdfError(t("shared.app.pdfFailed"));
      showToast(t("shared.app.pdfFailed"), "error");
    } finally {
      setPdfAction(null);
    }
  }

  function loadSampleInvoice() {
    setEdited(true);
    setInvoiceData(getSampleInvoice());
    setErrors({});
    setPdfError("");
    setActiveDialog(null);
    setActiveMobileTab("edit");
    trackEvent("sample_invoice_loaded");
    showToast(t("shared.app.sampleLoaded"));
  }

  function clearInvoice() {
    setEdited(true);
    setInvoiceData(getInitialBlankInvoice());
    setErrors({});
    setPdfError("");
    setShowTemplates(true);
    setActiveDialog(null);
    setActiveMobileTab("edit");
    trackEvent("invoice_draft_cleared");
    showToast(t("shared.app.draftCleared"));
  }

  function handleTrackClick(eventName: string) {
    if (eventName === "upgrade_pro_clicked" || eventName.includes("pro_only")) {
      setWaitlistError("");
      setActiveDialog("upgrade");
      trackEvent("upgrade_prompt_clicked", { item: eventName });
      return;
    }
    trackEvent(eventName);
  }

  function joinWaitlist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWaitlistError("");

    try {
      localStorage.setItem(
        "paperwork_pro_waitlist_interest",
        JSON.stringify({ email: waitlistEmail.trim(), savedAt: new Date().toISOString() }),
      );
    } catch (error) {
      console.error("Failed to save Paperwork Pro interest", error);
      setWaitlistError(t("shared.app.waitlistSaveFailed"));
      return;
    }

    setActiveDialog(null);
    setWaitlistEmail("");
    trackEvent("upgrade_waitlist_interest_saved");
    showToast(t("shared.app.interestSaved"));
  }

  function showMobileTab(tab: "edit" | "preview") {
    setActiveMobileTab(tab);
    window.requestAnimationFrame(() => {
      formSectionRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  }

  const storageFeedback = (
    <div className="flex w-full flex-wrap items-center justify-between gap-2" role="status">
      <Caption aria-live="polite" role="status">
        {!storageStatus.ready
          ? t("shared.storage.loading")
          : storageStatus.pending
            ? t("shared.storage.saving")
            : storageStatus.error
              ? t(storageStatus.reloadRequired ? "shared.storage.ownerChanged" : "shared.storage.failed")
              : t("shared.storage.saved")}
      </Caption>
      {storageStatus.error ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={storageStatus.pending > 0}
          onClick={() => (storageStatus.reloadRequired ? window.location.reload() : void DataBridge.retry())}
        >
          {t(storageStatus.reloadRequired ? "shared.storage.reload" : "shared.storage.retry")}
        </Button>
      ) : null}
    </div>
  );

  return (
    <div
      className="flex min-h-screen flex-col bg-background text-foreground selection:bg-foreground selection:text-primary-foreground"
      id="app-root"
      data-tool-locales={JSON.stringify(availableLocales)}
      data-language-switch-state={pdfAction ? "running" : edited ? "dirty" : "clean"}
      onInputCapture={() => setEdited(true)}
    >
      <ToolPageShell
        account={account}
        headerActions={<AccountNavigation {...account} />}
        productName="Paperwork"
        productHref="/paperwork"
        title={currentTool?.name ?? t("shared.app.documentWorkspace")}
        description={currentTool?.description ?? ""}
        category={common("documents")}
        categoryHref={localizeHref("/paperwork", locale)}
        breadcrumbCurrent={currentTool?.name}
        footer={<CanopyFooter />}
        workspaceId="tool-page-content"
        workspaceClassName="pb-4"
      >
        {isReceipt ? (
          <PaperworkWorkspace status={storageFeedback} title={currentTool?.name ?? t("shared.app.receiptGenerator")}>
            <ReceiptGeneratorPage embedded onTrackClick={handleTrackClick} templates={templates} />
          </PaperworkWorkspace>
        ) : ToolComponent ? (
          <PaperworkWorkspace status={storageFeedback} title={currentTool?.name ?? t("shared.app.documentWorkspace")}>
            <ToolComponent embedded onTrackClick={handleTrackClick} templates={templates} />
          </PaperworkWorkspace>
        ) : isInvoice ? (
          <>
            <PaperworkWorkspace
              status={storageFeedback}
              title={currentTool?.name ?? t("shared.app.invoiceGenerator")}
              actions={
                <div className="flex items-center gap-2">
                  {selectedTemplate.layoutFamily !== "advanced" ? (
                    <Button size="sm" variant="secondary" onClick={() => setActiveDialog("sample")}>
                      {t("shared.app.loadSample")}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setShowTemplates((shown) => !shown)}
                    aria-expanded={showTemplates}
                    aria-controls="invoice-template-options"
                  >
                    <Grid aria-hidden="true" className="size-3.5" />
                    {showTemplates ? t("shared.app.hideThemes") : t("shared.app.changeTheme")}
                  </Button>
                  {selectedTemplate.layoutFamily !== "advanced" ? (
                    <>
                      <Button
                        disabled={pdfAction !== null}
                        size="sm"
                        variant="secondary"
                        onClick={() => void generateInvoicePdf("print")}
                      >
                        <Printer aria-hidden="true" className="size-3.5" />
                        {pdfAction === "print" ? t("shared.app.opening") : t("shared.app.printPdf")}
                      </Button>
                      <ToolActionButton
                        action="download"
                        disabled={pdfAction !== null}
                        onClick={() => void generateInvoicePdf("download")}
                      >
                        {pdfAction === "download" ? t("shared.app.generating") : t("shared.app.downloadPdf")}
                      </ToolActionButton>
                    </>
                  ) : null}
                  <Button size="sm" variant="danger-subtle" onClick={() => setActiveDialog("clear")}>
                    {t("shared.app.clearInvoiceDraft")}
                  </Button>
                </div>
              }
            >
              <div id="invoice-generator" ref={formSectionRef}>
                <H2 className="sr-only">{t("shared.app.invoiceWorkspace")}</H2>
                <div className="min-w-0 p-3 sm:p-4">
                  {Object.keys(errors).length ? (
                    <AlertBanner
                      className="mb-6 print:hidden"
                      title={t("shared.app.fieldAttention", { count: Object.keys(errors).length })}
                      variant="warning"
                    >
                      {t("shared.app.reviewTheHighlightedSellerClientInvoiceLine")}
                    </AlertBanner>
                  ) : null}

                  {selectedTemplate.layoutFamily !== "advanced" ? (
                    <PaperworkMobileTabs
                      id="mobile-view-tabs"
                      className="mb-4 print:hidden lg:hidden"
                      onValueChange={(value) => showMobileTab(value as "edit" | "preview")}
                      value={activeMobileTab}
                    >
                      <TabsList
                        aria-label={t("shared.app.invoiceWorkspaceView")}
                        className="grid w-full grid-cols-2 border border-border"
                        variant="segmented"
                      >
                        <TabsTrigger
                          aria-controls="editor-panel"
                          className="min-h-11"
                          id="mobile-edit-tab"
                          value="edit"
                        >
                          <PenLine aria-hidden="true" className="size-4" />
                          {t("shared.app.editDetails")}
                        </TabsTrigger>
                        <TabsTrigger
                          aria-controls="preview-panel"
                          className="min-h-11"
                          id="mobile-preview-tab"
                          value="preview"
                        >
                          <Eye aria-hidden="true" className="size-4" />
                          {t("shared.app.livePreview")}
                        </TabsTrigger>
                      </TabsList>
                    </PaperworkMobileTabs>
                  ) : null}

                  {showTemplates ? (
                    <Card id="invoice-template-options" className="mb-4 p-3">
                      <TemplateSelector
                        documentLabel={t("shared.app.invoice")}
                        onSelect={(template) => {
                          setEdited(true);
                          setSelectedTemplate(template);
                          setInvoiceData((current) => ({ ...current, template: template.slug }));
                          showToast(t("shared.app.themeChanged", { name: template.name }));
                        }}
                        selectedTemplateId={selectedTemplate.id}
                        templates={templates}
                      />
                    </Card>
                  ) : null}
                  {selectedTemplate.layoutFamily === "advanced" ? (
                    <div className="grid min-w-0 gap-4">
                      <AdvancedTemplateWorkspace
                        adapter={invoiceAdapter}
                        draft={invoiceData}
                        onDraftChange={(nextDraft) => {
                          setEdited(true);
                          setInvoiceData(nextDraft);
                        }}
                        onTrackClick={handleTrackClick}
                        templates={[selectedTemplate]}
                      />
                    </div>
                  ) : (
                    <WorkbenchPanes
                      singlePaneDisplay="block"
                      className="grid min-w-0 items-start gap-4 lg:grid-cols-12"
                    >
                      <div
                        aria-labelledby="mobile-edit-tab"
                        className={`min-w-0 space-y-4 print:hidden lg:col-span-7 lg:block ${
                          activeMobileTab === "edit" ? "block" : "hidden"
                        }`}
                        id="editor-panel"
                        role="tabpanel"
                      >
                        <InvoiceForm
                          data={invoiceData}
                          errors={errors}
                          onChange={(nextDraft) => {
                            setEdited(true);
                            setInvoiceData(nextDraft);
                          }}
                        />
                      </div>
                      <div
                        aria-labelledby="mobile-preview-tab"
                        className={`min-w-0 space-y-3 print:block lg:col-span-5 lg:block ${
                          activeMobileTab === "preview" ? "block" : "hidden"
                        }`}
                        id="preview-panel"
                        role="tabpanel"
                      >
                        {pdfError ? (
                          <P className="text-destructive" role="alert">
                            {pdfError}
                          </P>
                        ) : null}
                        <Card className="overflow-hidden p-0">
                          <InvoicePreviewRenderer data={invoiceData} template={selectedTemplate} />
                        </Card>
                      </div>
                    </WorkbenchPanes>
                  )}
                </div>
              </div>
            </PaperworkWorkspace>
          </>
        ) : null}
        <section className="mt-4 border-t border-border pt-4 print:hidden" data-testid="tool-support">
          <Overline className="text-primary">{workbench("beforeContinue")}</Overline>
          <div className="mt-4 flex min-h-20 items-center justify-between gap-6 py-3 max-[52rem]:items-start max-[52rem]:flex-col">
            <div>
              <Overline>{workbench("relatedTools")}</Overline>
              <H2 className="mt-1">{workbench("continueRelated")}</H2>
              <Muted className="mt-1">{workbench("relatedDescription")}</Muted>
            </div>
            <nav
              aria-label={workbench("relatedCategory", { category: common("documents") })}
              className="flex flex-wrap justify-end gap-2"
            >
              {tools
                .filter((tool) => tool.componentKey !== componentKey)
                .map((tool) => (
                  <Button asChild key={tool.id} size="sm" variant="outline" className="h-9 rounded-lg">
                    <a href={localizeHref(`/paperwork/${tool.slug}`, locale)}>
                      {tool.name}
                      <ArrowUpRight aria-hidden="true" className="size-3.5" />
                    </a>
                  </Button>
                ))}
            </nav>
          </div>
        </section>
      </ToolPageShell>

      <AppDialog
        labelledBy="sample-dialog-title"
        onClose={() => setActiveDialog(null)}
        open={activeDialog === "sample"}
      >
        <div className="space-y-5 p-6">
          <div className="flex items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-full border border-primary/20 bg-primary/10 text-primary">
              <RefreshCw aria-hidden="true" className="size-5" />
            </div>
            <H2 id="sample-dialog-title">{t("shared.app.loadSampleInvoice")}</H2>
          </div>
          <Muted className="text-muted-foreground">{t("shared.app.thisReplacesEveryCurrentInvoiceFieldWith")}</Muted>
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => setActiveDialog(null)} variant="secondary">
              {t("shared.app.keepEditing")}
            </Button>
            <Button onClick={loadSampleInvoice} variant="strong">
              {t("shared.app.loadSampleInvoice2")}
            </Button>
          </div>
        </div>
      </AppDialog>

      <AppDialog labelledBy="clear-dialog-title" onClose={() => setActiveDialog(null)} open={activeDialog === "clear"}>
        <div className="space-y-5 p-6">
          <div className="flex items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-full border border-destructive/20 bg-destructive/10 text-destructive">
              <Trash2 aria-hidden="true" className="size-5" />
            </div>
            <H2 id="clear-dialog-title">{t("shared.app.clearThisInvoiceDraft")}</H2>
          </div>
          <Muted className="text-muted-foreground">{t("shared.app.thisPermanentlyRemovesTheCurrentInvoiceFrom")}</Muted>
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => setActiveDialog(null)} variant="secondary">
              {t("shared.app.keepInvoice")}
            </Button>
            <Button onClick={clearInvoice} variant="destructive">
              {t("shared.app.clearInvoiceDraft")}
            </Button>
          </div>
        </div>
      </AppDialog>

      <AppDialog
        labelledBy="upgrade-dialog-title"
        onClose={() => setActiveDialog(null)}
        open={activeDialog === "upgrade"}
      >
        <div className="relative space-y-6 p-6 sm:p-8">
          <Button
            aria-label={t("shared.app.closeWaitlistDialog")}
            className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
            onClick={() => setActiveDialog(null)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X aria-hidden="true" className="size-5" />
          </Button>
          <div className="space-y-3 pr-10">
            <div className="grid size-11 place-items-center rounded-xl bg-foreground text-background shadow-sm">
              <Sparkles aria-hidden="true" className="size-5" />
            </div>
            <P className="text-primary">{t("shared.app.paperworkProEarlyAccess")}</P>
            <H2 id="upgrade-dialog-title">{t("shared.app.joinThePaperworkProWaitlist")}</H2>
            <Muted className="text-muted-foreground">{t("shared.app.saveYourInterestLocallyForUpcomingCloud")}</Muted>
          </div>
          <form className="space-y-4" onSubmit={joinWaitlist}>
            <Field
              description={t("shared.app.storedOnlyInThisBrowserUntilRemote")}
              error={waitlistError || undefined}
              htmlFor="waitlist-email"
              label={t("shared.app.emailAddress")}
              required
            >
              <Input
                autoComplete="email"
                id="waitlist-email"
                onChange={(event) => setWaitlistEmail(event.target.value)}
                placeholder="you@example.com"
                required
                type="email"
                value={waitlistEmail}
              />
            </Field>
            <div className="flex flex-wrap justify-end gap-2">
              <Button onClick={() => setActiveDialog(null)} variant="secondary">
                {t("shared.app.notNow")}
              </Button>
              <Button type="submit" variant="strong">
                {t("shared.app.joinWaitingList")}
              </Button>
            </div>
          </form>
        </div>
      </AppDialog>
    </div>
  );
}
