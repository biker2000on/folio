'use client';

import { useState, useEffect, useCallback, useId, useRef } from 'react';
import { usePathname } from 'next/navigation';
import type { EntityDocument } from '@/lib/services/entity-documents.service';
import {
    getEditDocumentTypeOptions,
    getEntityDocumentContext,
    getTaxFormLabel,
    TAX_FORM_DEFINITIONS,
    type EntityDocumentProfile,
} from '@/lib/entity-document-context';
import { PageHeader } from '@/components/ui/PageHeader';
import { useDocumentPreview } from '@/components/documents/DocumentPreviewModal';
import {
    DocumentVaultBrowser,
    formatDocumentBytes,
    type VaultDocumentRow,
} from '@/components/documents/DocumentVaultBrowser';
import { useToast } from '@/contexts/ToastContext';
import { Tip } from '@/components/ui/Tooltip';
import { FileDropZone, type FileUploadOutcome } from '@/components/ui/FileDropZone';
import { ErrorLiveRegion } from '@/components/a11y/LiveRegion';
import { LABEL, SELECT, inputClass } from '@/components/ui/form';
import { readErrorBody } from '@/lib/api-error';
import {
    RECEIPT_MAX_FILE_SIZE,
    RECEIPT_SCREEN_RULES,
    formatSizeLimit,
} from '@/lib/upload-limits';

const TNUM = { fontFeatureSettings: "'tnum'" } as const;

/**
 * Button recipes for this page. They match the dominant PageHeader action
 * recipe used across the app (radius lg, px-4 py-2, 14px), so the vault's
 * buttons read the same as every other section's primary actions.
 */
const BUTTON_PRIMARY =
    'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-primary/50';
const BUTTON_SECONDARY =
    'rounded-lg border border-border px-4 py-2 text-sm text-foreground-secondary transition-colors hover:border-border-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50';

/**
 * The document intake runs the receipt pipeline's checks (10MB, PDF/PNG/JPEG
 * by magic bytes), so the drop zone screens against the same rules.
 */
const DOCUMENT_ACCEPT = '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg';

interface DocumentsResponse {
    // The list endpoint batches `tags` and `thumbnailStatus` onto every row;
    // typing them here is what lets the browser skip per-document fan-out.
    documents: VaultDocumentRow[];
    expiringSoon: VaultDocumentRow[];
    warningDays: number;
}

interface EditState {
    title: string;
    docType: string;
    expiresOn: string;
    issuedOn: string;
    returnCopyDueOn: string;
    notes: string;
    taxYear: string;
    taxForm: string;
    issuer: string;
    suggestedTags: string[];
}

function editStateFrom(doc: EntityDocument): EditState {
    return {
        title: doc.title,
        docType: doc.docType,
        expiresOn: doc.expiresOn ?? '',
        issuedOn: doc.issuedOn ?? '',
        returnCopyDueOn: doc.returnCopyDueOn ?? '',
        notes: doc.notes ?? '',
        taxYear: doc.taxYear === null ? '' : String(doc.taxYear),
        taxForm: doc.taxForm ?? '',
        issuer: doc.issuer ?? '',
        suggestedTags: [],
    };
}

function editStateToPayload(edit: EditState) {
    const taxYearParsed = parseInt(edit.taxYear, 10);
    return {
        title: edit.title,
        docType: edit.docType,
        expiresOn: edit.expiresOn || null,
        issuedOn: edit.issuedOn || null,
        returnCopyDueOn: edit.returnCopyDueOn || null,
        notes: edit.notes || null,
        taxYear: edit.docType === 'tax' && Number.isInteger(taxYearParsed) ? taxYearParsed : null,
        taxForm: edit.docType === 'tax' && edit.taxForm ? edit.taxForm : null,
        issuer: edit.docType === 'tax' && edit.issuer.trim() ? edit.issuer.trim() : null,
    };
}

/** One file in the pre-upload staging list. */
interface StagedFile {
    key: string;
    file: File;
    status: 'staged' | 'uploading' | 'done' | 'failed';
    error?: string;
}

interface DocumentSuggestions {
    suggestionKind: string;
    values: Record<string, unknown>;
}

/**
 * Why a request failed, in words a person can act on. A rejected `fetch`
 * (offline, server down) surfaces as a TypeError whose message is browser
 * jargon ("Failed to fetch"), so it is replaced rather than shown.
 */
function failureReason(err: unknown): string {
    if (err instanceof TypeError) return 'the server could not be reached';
    if (err instanceof Error && err.message.trim()) return err.message.trim();
    return 'the server returned an unexpected response';
}

function sentenceCase(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function stringValue(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringList(value: unknown): string[] {
    return Array.isArray(value)
        ? value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : [])
        : [];
}

function suggestedTagList(values: Record<string, unknown>): string[] {
    const tags = stringList(values.tags);
    return tags.length > 0 ? tags : stringList(values.suggestedTags);
}

function mergeSuggestionNote(existing: string, suggestion: string): string {
    if (!suggestion || existing.includes(suggestion)) return existing;
    return [existing, suggestion].filter(Boolean).join(' · ');
}

function suggestionSummary(suggestion: DocumentSuggestions): string {
    const values = suggestion.values;
    const tags = suggestedTagList(values);
    let parts: Array<string | number | null> = [];
    if (suggestion.suggestionKind === 'tax_record') {
        parts = [getTaxFormLabel(stringValue(values.taxForm)), typeof values.taxYear === 'number' ? values.taxYear : null, stringValue(values.issuer)];
    } else if (suggestion.suggestionKind === 'insurance_policy') {
        parts = [stringValue(values.provider), stringValue(values.policyType), stringValue(values.renewalDate)];
    } else if (suggestion.suggestionKind === 'estate_document') {
        parts = [stringValue(values.kind), stringValue(values.principalName), stringValue(values.executionDate)];
    } else {
        parts = [stringValue(values.documentClass), ...stringList(values.effectiveDates).slice(0, 1), ...stringList(values.parties).slice(0, 2)];
    }
    if (tags.length > 0) parts.push(`tags: ${tags.join(', ')}`);
    return parts.filter((part): part is string | number => part !== null && part !== '').join(' · ') || 'no suggestion';
}

/** Tax subtype fields shown whenever a form's type is 'tax'. */
function TaxFields({
    idPrefix,
    taxForm,
    taxYear,
    issuer,
    onChange,
}: {
    /** Unique per form instance, so each label points at its own control. */
    idPrefix: string;
    taxForm: string;
    taxYear: string;
    issuer: string;
    onChange: (patch: { taxForm?: string; taxYear?: string; issuer?: string }) => void;
}) {
    return (
        <>
            <div>
                <label htmlFor={`${idPrefix}-tax-form`} className={LABEL}>Tax form</label>
                <select
                    id={`${idPrefix}-tax-form`}
                    value={taxForm}
                    onChange={(e) => onChange({ taxForm: e.target.value })}
                    className={SELECT}
                >
                    <option value="">— Select form —</option>
                    {TAX_FORM_DEFINITIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                            {o.label}
                        </option>
                    ))}
                </select>
            </div>
            <div>
                <label htmlFor={`${idPrefix}-tax-year`} className={LABEL}>Tax year</label>
                <input
                    id={`${idPrefix}-tax-year`}
                    type="number"
                    min={1980}
                    max={2100}
                    value={taxYear}
                    onChange={(e) => onChange({ taxYear: e.target.value })}
                    placeholder="e.g. 2025"
                    className={inputClass({ extra: 'font-mono' })}
                />
            </div>
            <div>
                <label htmlFor={`${idPrefix}-issuer`} className={LABEL}>Issuer (institution)</label>
                <input
                    id={`${idPrefix}-issuer`}
                    type="text"
                    value={issuer}
                    onChange={(e) => onChange({ issuer: e.target.value })}
                    placeholder="e.g. Fidelity, Acme Corp"
                    className={inputClass()}
                />
            </div>
        </>
    );
}

export default function EntityDocumentsPage() {
    const toast = useToast();
    const documentPreview = useDocumentPreview();
    const pathname = usePathname();
    const uid = useId();
    const [data, setData] = useState<DocumentsResponse | null>(null);
    const [entityProfile, setEntityProfile] = useState<EntityDocumentProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [retrying, setRetrying] = useState(false);

    // Upload panel state — files stage locally and nothing is sent until
    // Upload is pressed; every staged file can be removed first.
    const [staged, setStaged] = useState<StagedFile[]>([]);
    const [uploadOpen, setUploadOpen] = useState(false);
    const [uploadTitle, setUploadTitle] = useState('');
    const [uploadType, setUploadType] = useState('other');
    const [uploadExpires, setUploadExpires] = useState('');
    const [uploadIssued, setUploadIssued] = useState('');
    const [uploadReturnCopyDue, setUploadReturnCopyDue] = useState('');
    const [uploadNotes, setUploadNotes] = useState('');
    const [uploadTaxYear, setUploadTaxYear] = useState('');
    const [uploadTaxForm, setUploadTaxForm] = useState('');
    const [uploadIssuer, setUploadIssuer] = useState('');
    const [uploading, setUploading] = useState(false);
    // The first empty load opens the upload panel; later loads leave it alone.
    const firstLoadSeen = useRef(false);

    // The shared drop zone keeps its own per-file status list. Here a "drop"
    // only stages a file, so a clean batch remounts the zone (clearing that
    // list) and the staging list below is the single place files appear.
    const [dropZoneKey, setDropZoneKey] = useState(0);
    const dropZoneRef = useRef<HTMLDivElement>(null);
    const restorePickerFocus = useRef(false);

    // Post-upload detailing pass: just-uploaded docs stay editable until
    // dismissed, so a bulk drop can be typed/dated per file afterwards.
    const [detailing, setDetailing] = useState<EntityDocument[]>([]);
    const [detailEdits, setDetailEdits] = useState<Record<number, EditState>>({});
    const [detailSaved, setDetailSaved] = useState<Record<number, boolean>>({});
    const [detailSaving, setDetailSaving] = useState<Record<number, boolean>>({});
    const [suggestions, setSuggestions] = useState<Record<number, DocumentSuggestions>>({});
    const pollTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

    // Inline edit state (existing documents)
    const [editingId, setEditingId] = useState<number | null>(null);
    const [edit, setEdit] = useState<EditState | null>(null);
    const [savingEdit, setSavingEdit] = useState(false);
    const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/business/documents');
            if (!res.ok) {
                throw new Error(await readErrorBody(res, `the server answered ${res.status}`));
            }
            const body = (await res.json()) as DocumentsResponse;
            setData(body);
            setError(null);
            if (!firstLoadSeen.current) {
                firstLoadSeen.current = true;
                if (body.documents.length === 0) setUploadOpen(true);
            }
        } catch (err) {
            setError(
                `Couldn't load your documents: ${failureReason(err)}. Nothing was changed. Retry, and if it keeps failing, reload the page.`
            );
        }
    }, []);

    const retryLoad = async () => {
        setRetrying(true);
        await load();
        setRetrying(false);
    };

    useEffect(() => {
        let cancelled = false;
        (async () => {
            await Promise.all([
                load(),
                (async () => {
                    try {
                        const res = await fetch('/api/entity');
                        if (!res.ok) throw new Error(`Request failed (${res.status})`);
                        const profile = (await res.json()) as EntityDocumentProfile;
                        if (!cancelled) setEntityProfile(profile);
                    } catch {
                        // Documents remain usable with deliberately neutral copy.
                        if (!cancelled) setEntityProfile(null);
                    }
                })(),
            ]);
            if (!cancelled) setLoading(false);
        })();
        return () => {
            cancelled = true;
        };
    }, [load]);

    useEffect(() => {
        const timers = pollTimers.current;
        return () => {
            for (const timer of timers.values()) clearTimeout(timer);
            timers.clear();
        };
    }, []);

    // After a clean batch remounts the drop zone, hand focus back to its
    // "Choose files" button if that is where the user was.
    useEffect(() => {
        if (!restorePickerFocus.current) return;
        restorePickerFocus.current = false;
        dropZoneRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    }, [dropZoneKey]);

    /**
     * Poll the suggestions endpoint for any document until the AI pass
     * finishes (bounded). Suggestions are advisory — Apply fills the form,
     * the user still saves.
     */
    const pollSuggestions = useCallback((documentId: number, attempt = 0) => {
        if (attempt >= 15) return;
        const timer = setTimeout(async () => {
            pollTimers.current.delete(documentId);
            try {
                const res = await fetch(`/api/business/documents/${documentId}/suggestions`);
                if (!res.ok) return;
                const body = await res.json();
                if (typeof body.suggestionKind === 'string' && body.suggestions && typeof body.suggestions === 'object') {
                    setSuggestions((prev) => ({
                        ...prev,
                        [documentId]: {
                            suggestionKind: body.suggestionKind,
                            values: body.suggestions as Record<string, unknown>,
                        },
                    }));
                    return;
                }
                if (body.extractionStatus === 'pending' || body.extractionStatus === 'processing') {
                    pollSuggestions(documentId, attempt + 1);
                }
            } catch {
                // Suggestion polling is best-effort.
            }
        }, attempt === 0 ? 2500 : 5000);
        pollTimers.current.set(documentId, timer);
    }, []);

    /**
     * The drop zone's per-file callback. It does NOT upload: it adds the file
     * to the staging list, so the category, dates and notes chosen below are
     * sent with it when Upload is pressed — the same semantics as before.
     */
    const stageFromDropZone = useCallback(async (file: File): Promise<FileUploadOutcome> => {
        setStaged((prev) => [
            ...prev,
            {
                key: `${file.name}:${file.size}:${file.lastModified}:${Math.random().toString(36).slice(2)}`,
                file,
                status: 'staged',
            },
        ]);
        return { ok: true, message: 'Added to the upload list' };
    }, []);

    const handleDropBatchSettled = useCallback(({ failed }: { succeeded: number; failed: number }) => {
        // Rejected files (too large, wrong type) never reach the staging
        // list; keep the zone's list so their reasons stay on screen.
        if (failed > 0) return;
        restorePickerFocus.current = Boolean(
            dropZoneRef.current && dropZoneRef.current.contains(document.activeElement)
        );
        setDropZoneKey((key) => key + 1);
    }, []);

    const removeStaged = (key: string) => {
        setStaged((prev) => prev.filter((s) => s.key !== key));
    };

    const clearStaged = () => {
        setStaged([]);
        setDropZoneKey((key) => key + 1);
    };

    /**
     * Open the upload panel (optionally with a category chosen) and move focus
     * to the file picker, so the next keystroke or tap is choosing files.
     */
    const openUpload = (docType?: string) => {
        if (docType) setUploadType(docType);
        setUploadOpen(true);
        requestAnimationFrame(() => {
            dropZoneRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
        });
    };

    const resetUploadForm = () => {
        clearStaged();
        setUploadTitle('');
        setUploadType('other');
        setUploadExpires('');
        setUploadIssued('');
        setUploadReturnCopyDue('');
        setUploadNotes('');
        setUploadTaxYear('');
        setUploadTaxForm('');
        setUploadIssuer('');
    };

    const handleUpload = async () => {
        const toUpload = staged.filter((s) => s.status === 'staged' || s.status === 'failed');
        if (toUpload.length === 0) {
            toast.error('Choose at least one file first');
            return;
        }
        setUploading(true);
        const singleFile = toUpload.length === 1 && staged.length === 1;
        const created: EntityDocument[] = [];
        let failures = 0;

        for (const item of toUpload) {
            setStaged((prev) =>
                prev.map((s) => (s.key === item.key ? { ...s, status: 'uploading', error: undefined } : s))
            );
            try {
                const formData = new FormData();
                formData.append('file', item.file);
                const title = singleFile && uploadTitle.trim()
                    ? uploadTitle.trim()
                    : item.file.name.replace(/\.[^.]+$/, '');
                formData.append('title', title);
                formData.append('doc_type', uploadType);
                if (uploadExpires) formData.append('expires_on', uploadExpires);
                if (uploadIssued) formData.append('issued_on', uploadIssued);
                if (uploadReturnCopyDue) formData.append('return_copy_due_on', uploadReturnCopyDue);
                if (uploadNotes.trim()) formData.append('notes', uploadNotes.trim());
                if (uploadType === 'tax') {
                    if (uploadTaxYear) formData.append('tax_year', uploadTaxYear);
                    if (uploadTaxForm) formData.append('tax_form', uploadTaxForm);
                    if (uploadIssuer.trim()) formData.append('issuer', uploadIssuer.trim());
                }

                const res = await fetch('/api/business/documents', { method: 'POST', body: formData });
                if (!res.ok) {
                    throw new Error(await readErrorBody(res, 'Upload failed'));
                }
                const { document } = (await res.json()) as { document: EntityDocument };
                created.push(document);
                setStaged((prev) =>
                    prev.map((s) => (s.key === item.key ? { ...s, status: 'done' } : s))
                );
            } catch (err) {
                failures += 1;
                setStaged((prev) =>
                    prev.map((s) =>
                        s.key === item.key
                            ? { ...s, status: 'failed', error: err instanceof Error ? err.message : 'Upload failed' }
                            : s
                    )
                );
            }
        }

        setUploading(false);
        if (created.length > 0) {
            toast.success(
                created.length === 1 ? 'Document uploaded' : `${created.length} documents uploaded`
            );
            setDetailing((prev) => [...prev, ...created]);
            setDetailEdits((prev) => ({
                ...prev,
                ...Object.fromEntries(created.map((doc) => [doc.id, editStateFrom(doc)])),
            }));
            for (const doc of created) {
                pollSuggestions(doc.id);
            }
            await load();
        }
        if (failures > 0) {
            toast.error(`${failures} file${failures === 1 ? '' : 's'} failed to upload`);
        } else if (created.length > 0) {
            resetUploadForm();
        }
    };

    const saveDetail = async (documentId: number) => {
        const detailEdit = detailEdits[documentId];
        if (!detailEdit) return;
        setDetailSaving((prev) => ({ ...prev, [documentId]: true }));
        try {
            const res = await fetch(`/api/business/documents/${documentId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editStateToPayload(detailEdit)),
            });
            if (!res.ok) {
                throw new Error(await readErrorBody(res, 'Save failed'));
            }
            setDetailSaved((prev) => ({ ...prev, [documentId]: true }));
            if (detailEdit.suggestedTags.length > 0) {
                const currentTagsResponse = await fetch(`/api/business/documents/${documentId}/tags`);
                if (!currentTagsResponse.ok && currentTagsResponse.status !== 404) {
                    throw new Error(await readErrorBody(currentTagsResponse, 'Failed to read document tags'));
                }
                if (currentTagsResponse.status !== 404) {
                    const currentTagsBody = await currentTagsResponse.json() as { tags?: string[] };
                    const acceptedTags = [...new Set([
                        ...(Array.isArray(currentTagsBody.tags) ? currentTagsBody.tags : []),
                        ...detailEdit.suggestedTags,
                    ])].sort((a, b) => a.localeCompare(b));
                    const tagResponse = await fetch(`/api/business/documents/${documentId}/tags`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tags: acceptedTags }),
                    });
                    if (!tagResponse.ok && tagResponse.status !== 404) {
                        throw new Error(await readErrorBody(tagResponse, 'Failed to save suggested tags'));
                    }
                }
            }
            // A changed category can select a different extraction schema.
            const previousType = detailing.find((d) => d.id === documentId)?.docType;
            const expectedSuggestionKind = detailEdit.docType === 'tax'
                ? 'tax_record'
                : detailEdit.docType === 'insurance'
                  ? 'insurance_policy'
                  : detailEdit.docType === 'estate'
                    ? 'estate_document'
                    : 'generic_document';
            if (detailEdit.docType !== previousType && suggestions[documentId]?.suggestionKind !== expectedSuggestionKind) {
                fetch(`/api/business/documents/${documentId}/suggestions`, { method: 'POST' })
                    .then(() => pollSuggestions(documentId))
                    .catch(() => undefined);
            }
            await load();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to save details');
        } finally {
            setDetailSaving((prev) => ({ ...prev, [documentId]: false }));
        }
    };

    const applyTypeToAll = (docType: string) => {
        setDetailEdits((prev) =>
            Object.fromEntries(
                Object.entries(prev).map(([id, state]) => [id, { ...state, docType }])
            )
        );
        setDetailSaved({});
    };

    const documents = data?.documents ?? [];
    const expiring = data?.expiringSoon ?? [];
    // Household books reach this vault at /home/documents. While the entity
    // profile is still loading, that route is enough to title the page the
    // way the sidebar does, instead of flashing the neutral "Documents".
    const onHomeRoute = pathname?.startsWith('/home/') ?? false;
    const context = getEntityDocumentContext(
        entityProfile ?? (loading && onHomeRoute ? { entityType: 'household' } : null)
    );
    const stagedCount = staged.filter((s) => s.status === 'staged' || s.status === 'failed').length;
    const untypedCount = detailing.filter(
        (doc) => (detailEdits[doc.id]?.docType ?? doc.docType) === 'other'
    ).length;
    const ready = !loading && !error && data !== null;

    const applySuggestion = (documentId: number) => {
        const suggestion = suggestions[documentId];
        if (!suggestion) return;
        setDetailEdits((prev) => {
            const current = prev[documentId];
            if (!current) return prev;
            const values = suggestion.values;
            const next = { ...current, suggestedTags: suggestedTagList(values) };
            if (suggestion.suggestionKind === 'tax_record') {
                const taxYear = typeof values.taxYear === 'number' ? values.taxYear : null;
                return {
                    ...prev,
                    [documentId]: {
                        ...next,
                        docType: 'tax',
                        taxForm: stringValue(values.taxForm) ?? current.taxForm,
                        taxYear: taxYear !== null ? String(taxYear) : current.taxYear,
                        issuer: stringValue(values.issuer) ?? current.issuer,
                    },
                };
            }
            if (suggestion.suggestionKind === 'insurance_policy') {
                const provider = stringValue(values.provider);
                const policy = stringValue(values.policyNumberMasked);
                const note = [provider ? `Provider: ${provider}` : null, policy ? `Policy: ${policy}` : null]
                    .filter(Boolean).join(' · ');
                next.expiresOn = stringValue(values.renewalDate) ?? next.expiresOn;
                next.notes = mergeSuggestionNote(next.notes, note);
            } else if (suggestion.suggestionKind === 'estate_document') {
                const principal = stringValue(values.principalName);
                const kind = stringValue(values.kind);
                const state = stringValue(values.state);
                const note = [kind ? `Kind: ${kind}` : null, principal ? `Principal: ${principal}` : null, state ? `State: ${state}` : null]
                    .filter(Boolean).join(' · ');
                next.issuedOn = stringValue(values.executionDate) ?? next.issuedOn;
                next.notes = mergeSuggestionNote(next.notes, note);
            } else {
                const documentClass = stringValue(values.documentClass);
                const normalizedClass = documentClass?.toLowerCase().replace(/[_-]+/g, ' ').trim();
                const matchingType = context.typeOptions.find((option) =>
                    option.value === documentClass
                    || option.value.replace(/[_-]+/g, ' ').toLowerCase() === normalizedClass
                    || option.label.toLowerCase() === normalizedClass
                );
                const parties = stringList(values.parties);
                const references = stringList(values.referenceNumbers);
                const note = [
                    parties.length > 0 ? `Parties: ${parties.join(', ')}` : null,
                    references.length > 0 ? `References: ${references.join(', ')}` : null,
                ].filter(Boolean).join(' · ');
                if (matchingType) next.docType = matchingType.value;
                next.issuedOn = stringList(values.effectiveDates)[0] ?? next.issuedOn;
                next.notes = mergeSuggestionNote(next.notes, note);
            }
            return {
                ...prev,
                [documentId]: next,
            };
        });
        setDetailSaved((prev) => ({ ...prev, [documentId]: false }));
    };

    const dismissDetailing = () => {
        setDetailing([]);
        setDetailEdits({});
        setDetailSaved({});
        setDetailSaving({});
        setSuggestions({});
        for (const timer of pollTimers.current.values()) clearTimeout(timer);
        pollTimers.current.clear();
    };

    const startEdit = (doc: EntityDocument) => {
        setEditingId(doc.id);
        setEdit(editStateFrom(doc));
        setConfirmDeleteId(null);
    };

    const handleSaveEdit = async (id: number) => {
        if (!edit) return;
        setSavingEdit(true);
        try {
            const res = await fetch(`/api/business/documents/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editStateToPayload(edit)),
            });
            if (!res.ok) {
                throw new Error(await readErrorBody(res, 'Save failed'));
            }
            toast.success('Document updated');
            setEditingId(null);
            setEdit(null);
            await load();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to update document');
        } finally {
            setSavingEdit(false);
        }
    };

    const handleDelete = async (id: number) => {
        const title = documents.find((doc) => doc.id === id)?.title;
        const name = title ? `“${title}”` : 'this document';
        try {
            const res = await fetch(`/api/business/documents/${id}`, { method: 'DELETE' });
            if (!res.ok) {
                throw new Error(await readErrorBody(res, `the server answered ${res.status}`));
            }
            toast.success(title ? `Deleted ${name}` : 'Document deleted');
            setConfirmDeleteId(null);
            await load();
        } catch (err) {
            toast.error(
                `Couldn't delete ${name}: ${failureReason(err)}. It is still in the vault; try again.`
            );
        }
    };

    const renderDocumentEditor = (doc: EntityDocument) => {
        if (editingId !== doc.id || !edit) return null;
        const idPrefix = `${uid}-edit-${doc.id}`;
        return (
            <div className="col-span-full rounded-md border border-border bg-background-tertiary/30 px-4 py-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                        <label htmlFor={`${idPrefix}-title`} className={LABEL}>Title</label>
                        <input
                            id={`${idPrefix}-title`}
                            type="text"
                            value={edit.title}
                            onChange={(e) => setEdit({ ...edit, title: e.target.value })}
                            className={inputClass()}
                        />
                    </div>
                    <div>
                        <label htmlFor={`${idPrefix}-type`} className={LABEL}>Type</label>
                        <select
                            id={`${idPrefix}-type`}
                            value={edit.docType}
                            onChange={(e) => setEdit({ ...edit, docType: e.target.value })}
                            className={SELECT}
                        >
                            {getEditDocumentTypeOptions(context, doc.docType).map((o) => (
                                <option key={o.value} value={o.value}>
                                    {o.label}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor={`${idPrefix}-expires`} className={LABEL}>Expires</label>
                        <input
                            id={`${idPrefix}-expires`}
                            type="date"
                            value={edit.expiresOn}
                            onChange={(e) => setEdit({ ...edit, expiresOn: e.target.value })}
                            className={inputClass({ extra: 'font-mono' })}
                        />
                    </div>
                    <div>
                        <label htmlFor={`${idPrefix}-notes`} className={LABEL}>Notes</label>
                        <input
                            id={`${idPrefix}-notes`}
                            type="text"
                            value={edit.notes}
                            onChange={(e) => setEdit({ ...edit, notes: e.target.value })}
                            className={inputClass()}
                        />
                    </div>
                    {edit.docType === 'tax' && (
                        <TaxFields
                            idPrefix={idPrefix}
                            taxForm={edit.taxForm}
                            taxYear={edit.taxYear}
                            issuer={edit.issuer}
                            onChange={(patch) => setEdit({ ...edit, ...patch })}
                        />
                    )}
                    {(edit.docType === 'farm_certificate_qf' || edit.docType === 'farm_certificate_cf') && (
                        <>
                            <div>
                                <label htmlFor={`${idPrefix}-issued`} className={LABEL}>Issued</label>
                                <input
                                    id={`${idPrefix}-issued`}
                                    type="date"
                                    value={edit.issuedOn}
                                    onChange={(e) => setEdit({ ...edit, issuedOn: e.target.value })}
                                    className={inputClass({ extra: 'font-mono' })}
                                />
                            </div>
                            <div>
                                <label htmlFor={`${idPrefix}-return-copy`} className={LABEL}>Return copy due</label>
                                <input
                                    id={`${idPrefix}-return-copy`}
                                    type="date"
                                    value={edit.returnCopyDueOn}
                                    onChange={(e) => setEdit({ ...edit, returnCopyDueOn: e.target.value })}
                                    className={inputClass({ extra: 'font-mono' })}
                                />
                            </div>
                        </>
                    )}
                </div>
                <div className="mt-3 flex items-center gap-3">
                    <button
                        type="button"
                        onClick={() => handleSaveEdit(doc.id)}
                        disabled={savingEdit}
                        className={BUTTON_PRIMARY}
                    >
                        {savingEdit ? 'Saving…' : 'Save'}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setEditingId(null);
                            setEdit(null);
                        }}
                        className={BUTTON_SECONDARY}
                    >
                        Cancel
                    </button>
                </div>
            </div>
        );
    };

    const uploadId = `${uid}-upload`;

    return (
        <div className="space-y-6">
            <PageHeader
                title={context.title}
                subtitle={context.subtitle}
                actions={ready ? (
                    <button type="button" onClick={() => openUpload()} className={BUTTON_PRIMARY}>
                        Upload documents
                    </button>
                ) : undefined}
            />

            {loading && (
                <div className="flex items-center justify-center py-12">
                    <div className="flex items-center gap-3">
                        <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                        <span className="text-foreground-secondary">Loading...</span>
                    </div>
                </div>
            )}

            {!loading && error && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-error/30 bg-surface/30 p-4">
                    <p className="text-sm text-error">{error}</p>
                    <button
                        type="button"
                        onClick={() => void retryLoad()}
                        disabled={retrying}
                        className={BUTTON_SECONDARY}
                    >
                        {retrying ? 'Retrying…' : 'Retry'}
                    </button>
                </div>
            )}

            {ready && (
                <>
                    {expiring.length > 0 && (
                        <div className="border border-warning/30 bg-warning/5 rounded-lg px-4 py-3 text-sm text-foreground-secondary">
                            <span className="font-medium text-foreground">
                                {expiring.length} document{expiring.length === 1 ? '' : 's'}
                            </span>{' '}
                            expired or expiring within {data.warningDays} days:{' '}
                            {expiring.map((d) => d.title).join(', ')}. Renew and upload the new
                            versions.
                        </div>
                    )}

                    {/* First-use empty state: the starter set is the call to action. */}
                    {documents.length === 0 && (
                        <section
                            aria-labelledby={`${uid}-starter`}
                            className="rounded-lg border border-border bg-background-secondary/30 p-6"
                        >
                            <h2 id={`${uid}-starter`} className="text-sm font-semibold text-foreground">
                                {context.starterIntro}
                            </h2>
                            <p className="mt-1 text-sm text-foreground-secondary">
                                Pick one to upload it with its category already set, or drop any file
                                into the upload panel below.
                            </p>
                            <ul className="mt-4 flex flex-wrap gap-2">
                                {context.starterDocuments.map((starter) => {
                                    const chosen = uploadOpen && uploadType === starter.docType;
                                    return (
                                        <li key={starter.label}>
                                            <button
                                                type="button"
                                                aria-pressed={chosen}
                                                onClick={() => openUpload(starter.docType)}
                                                className={`inline-flex min-h-10 items-center rounded-md border px-3 py-2 text-sm transition-colors ${
                                                    chosen
                                                        ? 'border-primary bg-primary-light text-primary'
                                                        : 'border-border bg-surface text-foreground hover:border-border-hover hover:text-primary'
                                                }`}
                                            >
                                                {sentenceCase(starter.label)}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>
                    )}

                    {/* Upload panel — open on an empty vault, folded otherwise; staging a file keeps it open. */}
                    <details
                        className="bg-background-secondary/30 border border-border rounded-lg"
                        open={uploadOpen || staged.length > 0}
                        onToggle={(e) => setUploadOpen(e.currentTarget.open)}
                    >
                        <summary className="cursor-pointer select-none rounded-lg px-4 py-3 text-sm font-medium text-foreground-secondary hover:text-foreground">
                            Upload documents
                        </summary>
                        <div className="p-4 pt-1 space-y-4">
                            <div ref={dropZoneRef}>
                                <FileDropZone
                                    key={dropZoneKey}
                                    accept={DOCUMENT_ACCEPT}
                                    rules={RECEIPT_SCREEN_RULES}
                                    label="Add documents to upload"
                                    prompt="Drop files here to add them to the upload list"
                                    hint={`PDF, PNG, or JPEG up to ${formatSizeLimit(RECEIPT_MAX_FILE_SIZE)} each. Nothing is sent until you press Upload.`}
                                    buttonLabel="Choose files"
                                    onUploadFile={stageFromDropZone}
                                    onBatchSettled={handleDropBatchSettled}
                                    disabled={uploading}
                                />
                            </div>

                            {/* Staged files: reviewable and removable before anything is sent */}
                            {staged.length > 0 && (
                                <ul
                                    aria-label="Files to upload"
                                    aria-live="polite"
                                    className="divide-y divide-border/30 rounded-lg border border-border"
                                >
                                    {staged.map((item) => (
                                        <li
                                            key={item.key}
                                            className="flex items-center gap-3 px-3 py-1 text-sm"
                                        >
                                            <span className="min-w-0 flex-1 truncate py-1 text-foreground">
                                                {item.file.name}
                                                <span className="ml-2 font-mono text-xs text-foreground-muted" style={TNUM}>
                                                    ({formatDocumentBytes(item.file.size)})
                                                </span>
                                            </span>
                                            {item.status === 'uploading' && (
                                                <span className="text-xs text-foreground-muted">Uploading…</span>
                                            )}
                                            {item.status === 'done' && (
                                                <span className="text-xs text-success">Uploaded</span>
                                            )}
                                            {item.status === 'failed' && (
                                                <Tip content={item.error}>
                                                    <span className="text-xs text-error">
                                                        {item.error ?? 'Failed'}
                                                    </span>
                                                </Tip>
                                            )}
                                            {(item.status === 'staged' || item.status === 'failed') && !uploading && (
                                                <button
                                                    type="button"
                                                    onClick={() => removeStaged(item.key)}
                                                    aria-label={`Remove ${item.file.name}`}
                                                    className="-mr-2 inline-flex min-h-9 items-center px-2 text-xs text-foreground-muted transition-colors hover:text-error"
                                                >
                                                    Remove
                                                </button>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}

                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                <div>
                                    <label htmlFor={`${uploadId}-title`} className={LABEL}>
                                        Title{staged.length > 1 ? ' (single file only — batches use filenames)' : ''}
                                    </label>
                                    <input
                                        id={`${uploadId}-title`}
                                        type="text"
                                        value={uploadTitle}
                                        onChange={(e) => setUploadTitle(e.target.value)}
                                        placeholder={context.uploadTitlePlaceholder}
                                        disabled={staged.length > 1}
                                        className={inputClass({ extra: 'disabled:cursor-not-allowed disabled:opacity-50' })}
                                    />
                                </div>
                                <div>
                                    <label htmlFor={`${uploadId}-type`} className={LABEL}>
                                        Type{staged.length > 1 ? ' (applies to all staged files)' : ''}
                                    </label>
                                    <select
                                        id={`${uploadId}-type`}
                                        value={uploadType}
                                        onChange={(e) => setUploadType(e.target.value)}
                                        className={SELECT}
                                    >
                                        {context.typeOptions.map((o) => (
                                            <option key={o.value} value={o.value}>
                                                {o.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label htmlFor={`${uploadId}-expires`} className={LABEL}>Expires (optional)</label>
                                    <input
                                        id={`${uploadId}-expires`}
                                        type="date"
                                        value={uploadExpires}
                                        onChange={(e) => setUploadExpires(e.target.value)}
                                        className={inputClass({ extra: 'font-mono' })}
                                    />
                                </div>
                                {uploadType === 'tax' && (
                                    <TaxFields
                                        idPrefix={uploadId}
                                        taxForm={uploadTaxForm}
                                        taxYear={uploadTaxYear}
                                        issuer={uploadIssuer}
                                        onChange={(patch) => {
                                            if (patch.taxForm !== undefined) setUploadTaxForm(patch.taxForm);
                                            if (patch.taxYear !== undefined) setUploadTaxYear(patch.taxYear);
                                            if (patch.issuer !== undefined) setUploadIssuer(patch.issuer);
                                        }}
                                    />
                                )}
                                {(uploadType === 'farm_certificate_qf' || uploadType === 'farm_certificate_cf') && (
                                    <>
                                        <div>
                                            <label htmlFor={`${uploadId}-issued`} className={LABEL}>Issued (optional)</label>
                                            <input
                                                id={`${uploadId}-issued`}
                                                type="date"
                                                value={uploadIssued}
                                                onChange={(e) => setUploadIssued(e.target.value)}
                                                className={inputClass({ extra: 'font-mono' })}
                                            />
                                        </div>
                                        <div>
                                            <label htmlFor={`${uploadId}-return-copy`} className={LABEL}>Return copy due (optional)</label>
                                            <input
                                                id={`${uploadId}-return-copy`}
                                                type="date"
                                                value={uploadReturnCopyDue}
                                                onChange={(e) => setUploadReturnCopyDue(e.target.value)}
                                                className={inputClass({ extra: 'font-mono' })}
                                            />
                                        </div>
                                    </>
                                )}
                                <div className="sm:col-span-2 lg:col-span-3">
                                    <label htmlFor={`${uploadId}-notes`} className={LABEL}>Notes (optional)</label>
                                    <input
                                        id={`${uploadId}-notes`}
                                        type="text"
                                        value={uploadNotes}
                                        onChange={(e) => setUploadNotes(e.target.value)}
                                        placeholder={context.notesPlaceholder}
                                        className={inputClass()}
                                    />
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-3">
                                <button
                                    type="button"
                                    onClick={handleUpload}
                                    disabled={uploading || stagedCount === 0}
                                    className={BUTTON_PRIMARY}
                                >
                                    {uploading
                                        ? 'Uploading…'
                                        : stagedCount > 1
                                          ? `Upload ${stagedCount} files`
                                          : 'Upload'}
                                </button>
                                {staged.length > 0 && !uploading && (
                                    <button
                                        type="button"
                                        onClick={clearStaged}
                                        className={BUTTON_SECONDARY}
                                    >
                                        Clear list
                                    </button>
                                )}
                                {stagedCount === 0 && !uploading && (
                                    <span className="text-xs text-foreground-muted">
                                        Choose or drop at least one file to upload.
                                    </span>
                                )}
                            </div>
                        </div>
                    </details>

                    {/* Post-upload detailing pass */}
                    {detailing.length > 0 && (
                        <div className="bg-background-secondary/30 border border-primary/30 rounded-lg p-4 space-y-3">
                            <div className="flex flex-wrap items-center gap-3">
                                <h3 className="text-sm font-medium text-foreground">
                                    Set details for the uploaded files
                                </h3>
                                <span className="font-mono text-xs text-foreground-muted" style={TNUM}>
                                    {untypedCount > 0
                                        ? `${untypedCount} of ${detailing.length} still untyped`
                                        : `${detailing.length} file${detailing.length === 1 ? '' : 's'}`}
                                </span>
                                {detailing.length > 1 && (
                                    <label className="ml-auto flex items-center gap-2 text-xs text-foreground-secondary">
                                        Apply type to all
                                        <select
                                            defaultValue=""
                                            onChange={(e) => {
                                                if (e.target.value) applyTypeToAll(e.target.value);
                                                e.target.value = '';
                                            }}
                                            className={inputClass({ base: SELECT, extra: 'w-auto' })}
                                        >
                                            <option value="">— choose —</option>
                                            {context.typeOptions.map((o) => (
                                                <option key={o.value} value={o.value}>
                                                    {o.label}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                )}
                                <button
                                    type="button"
                                    onClick={dismissDetailing}
                                    className={BUTTON_SECONDARY}
                                >
                                    Done
                                </button>
                            </div>
                            <ul className="divide-y divide-border/30">
                                {detailing.map((doc) => {
                                    const detailEdit = detailEdits[doc.id];
                                    if (!detailEdit) return null;
                                    const suggestion = suggestions[doc.id];
                                    const idPrefix = `${uid}-detail-${doc.id}`;
                                    return (
                                        <li key={doc.id} className="py-3 space-y-2">
                                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                                <span className="font-mono text-xs text-foreground-muted" style={TNUM}>
                                                    {doc.fileName}
                                                </span>
                                                {detailSaved[doc.id] && (
                                                    <span className="text-xs text-success">Saved</span>
                                                )}
                                                {suggestion && (
                                                    <span className="flex items-center gap-2 text-xs text-foreground-secondary">
                                                        <span className="inline-block rounded-full border border-primary/30 bg-primary-light px-2 py-0.5 text-[11px]">
                                                            AI: {suggestionSummary(suggestion)}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => applySuggestion(doc.id)}
                                                            className="text-primary hover:text-primary-hover transition-colors"
                                                        >
                                                            Apply
                                                        </button>
                                                    </span>
                                                )}
                                            </div>
                                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                                <div>
                                                    <label htmlFor={`${idPrefix}-title`} className={LABEL}>Title</label>
                                                    <input
                                                        id={`${idPrefix}-title`}
                                                        type="text"
                                                        value={detailEdit.title}
                                                        onChange={(e) => {
                                                            setDetailEdits((prev) => ({
                                                                ...prev,
                                                                [doc.id]: { ...detailEdit, title: e.target.value },
                                                            }));
                                                            setDetailSaved((prev) => ({ ...prev, [doc.id]: false }));
                                                        }}
                                                        className={inputClass()}
                                                    />
                                                </div>
                                                <div>
                                                    <label htmlFor={`${idPrefix}-type`} className={LABEL}>Type</label>
                                                    <select
                                                        id={`${idPrefix}-type`}
                                                        value={detailEdit.docType}
                                                        onChange={(e) => {
                                                            setDetailEdits((prev) => ({
                                                                ...prev,
                                                                [doc.id]: { ...detailEdit, docType: e.target.value },
                                                            }));
                                                            setDetailSaved((prev) => ({ ...prev, [doc.id]: false }));
                                                        }}
                                                        className={SELECT}
                                                    >
                                                        {getEditDocumentTypeOptions(context, doc.docType).map((o) => (
                                                            <option key={o.value} value={o.value}>
                                                                {o.label}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label htmlFor={`${idPrefix}-expires`} className={LABEL}>Expires</label>
                                                    <input
                                                        id={`${idPrefix}-expires`}
                                                        type="date"
                                                        value={detailEdit.expiresOn}
                                                        onChange={(e) => {
                                                            setDetailEdits((prev) => ({
                                                                ...prev,
                                                                [doc.id]: { ...detailEdit, expiresOn: e.target.value },
                                                            }));
                                                            setDetailSaved((prev) => ({ ...prev, [doc.id]: false }));
                                                        }}
                                                        className={inputClass({ extra: 'font-mono' })}
                                                    />
                                                </div>
                                                {detailEdit.docType === 'tax' && (
                                                    <TaxFields
                                                        idPrefix={idPrefix}
                                                        taxForm={detailEdit.taxForm}
                                                        taxYear={detailEdit.taxYear}
                                                        issuer={detailEdit.issuer}
                                                        onChange={(patch) => {
                                                            setDetailEdits((prev) => ({
                                                                ...prev,
                                                                [doc.id]: { ...detailEdit, ...patch },
                                                            }));
                                                            setDetailSaved((prev) => ({ ...prev, [doc.id]: false }));
                                                        }}
                                                    />
                                                )}
                                                <div className="flex items-end">
                                                    <button
                                                        type="button"
                                                        onClick={() => saveDetail(doc.id)}
                                                        disabled={detailSaving[doc.id] || detailSaved[doc.id]}
                                                        className={BUTTON_PRIMARY}
                                                    >
                                                        {detailSaving[doc.id]
                                                            ? 'Saving…'
                                                            : detailSaved[doc.id]
                                                              ? 'Saved'
                                                              : 'Save'}
                                                    </button>
                                                </div>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    )}

                    {documents.length > 0 && (
                        <DocumentVaultBrowser
                            documents={documents}
                            categoryOptions={context.typeOptions}
                            onPreview={(doc) => documentPreview.open({
                                documentId: doc.id,
                                title: doc.title,
                                fileName: doc.fileName,
                                mimeType: doc.mimeType,
                            })}
                            onEdit={(doc) => {
                                if (editingId === doc.id) {
                                    setEditingId(null);
                                    setEdit(null);
                                } else {
                                    startEdit(doc);
                                }
                            }}
                            onDelete={handleDelete}
                            editingId={editingId}
                            confirmDeleteId={confirmDeleteId}
                            onRequestDelete={setConfirmDeleteId}
                            renderEditor={renderDocumentEditor}
                        />
                    )}

                    <p className="text-xs text-foreground-muted">
                        Files are stored with the same backend as receipts (10MB max; PDF, PNG, JPEG).
                        Expiry reminders surface here when a document is expired or within{' '}
                        {data.warningDays} days of expiry. Tax records with a year and form type are
                        grouped by tax year and checked against the prior year&apos;s forms.
                    </p>
                </>
            )}

            {documentPreview.preview}
            <ErrorLiveRegion message={loading ? null : error} />
        </div>
    );
}
