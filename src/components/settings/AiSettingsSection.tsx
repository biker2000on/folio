'use client';

import { useCallback, useEffect, useState } from 'react';
import { CollapsibleConfigSection } from '@/components/ui/CollapsibleConfigSection';
import { Field, FieldGrid, INPUT, SELECT } from '@/components/ui/form';
import { useToast } from '@/contexts/ToastContext';
import { extractErrorMessage } from '@/lib/api-error';
import {
    DEFAULT_PRIVACY_MODE,
    PRIVACY_MODE_OPTIONS,
    isKnownCloudEndpoint,
    isLikelySelfHostedUrl,
    type PrivacyMode,
} from '@/lib/ai-privacy/privacy';

interface AiConfigDisplay {
    provider: string;
    base_url: string | null;
    has_api_key: boolean;
    api_key_valid: boolean;
    model: string | null;
    enabled: boolean;
    privacy_mode: PrivacyMode;
    self_hosted: boolean;
    self_hosted_suggested: boolean;
}

const PROVIDERS: Array<{ value: string; label: string; placeholder: string }> = [
    { value: 'ollama', label: 'Ollama', placeholder: 'http://localhost:11434/v1' },
    { value: 'openai', label: 'OpenAI', placeholder: 'https://api.openai.com/v1' },
    { value: 'openrouter', label: 'OpenRouter', placeholder: 'https://openrouter.ai/api/v1' },
    { value: 'custom', label: 'Other (OpenAI-compatible)', placeholder: 'https://host/v1' },
];

const BUTTON = 'px-3 py-1.5 text-sm rounded-lg border border-border text-foreground hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed';
const PRIMARY_BUTTON = 'px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed';

export function AiSettingsSection() {
    const { success, error } = useToast();
    const [loaded, setLoaded] = useState(false);
    const [saved, setSaved] = useState<AiConfigDisplay | null>(null);
    const [provider, setProvider] = useState('custom');
    const [baseUrl, setBaseUrl] = useState('');
    const [model, setModel] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [clearKey, setClearKey] = useState(false);
    const [enabled, setEnabled] = useState(false);
    const [mode, setMode] = useState<PrivacyMode>(DEFAULT_PRIVACY_MODE);
    const [selfHosted, setSelfHosted] = useState(false);
    const [busy, setBusy] = useState<'save' | 'test' | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/settings/ai');
            if (!res.ok) throw new Error();
            const data = (await res.json()) as AiConfigDisplay;
            setSaved(data);
            setProvider(data.provider && data.provider !== 'none' ? data.provider : 'custom');
            setBaseUrl(data.base_url ?? '');
            setModel(data.model ?? '');
            setEnabled(!!data.enabled);
            setMode(data.privacy_mode ?? DEFAULT_PRIVACY_MODE);
            setSelfHosted(!!data.self_hosted);
            setApiKey('');
            setClearKey(false);
        } catch {
            // keep the form as it is
        } finally {
            setLoaded(true);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    // Re-suggest the self-hosted box when the address changes. The user can
    // still change it; what is saved is their choice.
    const changeBaseUrl = (next: string) => {
        if (isLikelySelfHostedUrl(next) !== isLikelySelfHostedUrl(baseUrl)) {
            setSelfHosted(isLikelySelfHostedUrl(next));
        }
        setBaseUrl(next);
    };

    const suggested = isLikelySelfHostedUrl(baseUrl);
    const cloud = isKnownCloudEndpoint(baseUrl);
    const fullDowngraded = mode === 'full' && (!selfHosted || cloud);

    const save = async () => {
        setBusy('save');
        try {
            const res = await fetch('/api/settings/ai', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider,
                    base_url: baseUrl.trim() || null,
                    model: model.trim() || null,
                    api_key: apiKey.trim() || undefined,
                    clear_api_key: clearKey,
                    enabled,
                    privacy_mode: mode,
                    self_hosted: selfHosted,
                }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) throw new Error(extractErrorMessage(data, 'Could not save AI settings'));
            success('AI settings saved');
            void load();
        } catch (e) {
            error(e instanceof Error ? e.message : 'Could not save AI settings');
        } finally {
            setBusy(null);
        }
    };

    const test = async () => {
        setBusy('test');
        try {
            const res = await fetch('/api/settings/ai/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider, base_url: baseUrl.trim(), model: model.trim(), api_key: apiKey.trim() || undefined }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.success) throw new Error(extractErrorMessage(data, 'Connection test failed'));
            if (data.extraction_method === 'ai') success('Connected. The model answered.');
            else error('The model did not answer. Check the address, model and key.');
        } catch (e) {
            error(e instanceof Error ? e.message : 'Connection test failed');
        } finally {
            setBusy(null);
        }
    };

    const configured = !!saved && saved.enabled && !!saved.base_url && !!saved.model;
    const modeLabel = PRIVACY_MODE_OPTIONS.find(o => o.value === (saved?.privacy_mode ?? DEFAULT_PRIVACY_MODE))?.label;
    const placeholder = PROVIDERS.find(p => p.value === provider)?.placeholder ?? 'https://host/v1';

    return (
        <CollapsibleConfigSection
            title="AI"
            summary={configured ? `${saved?.model} · ${modeLabel}` : 'Not configured'}
            configured={loaded && configured}
            storageKey="settings.aiOpen"
        >
            <div className="space-y-5">
                <p className="text-sm text-foreground-muted">
                    Connect an OpenAI-compatible model for Ask your books, the digest summary, insight wording and
                    document extraction.
                </p>

                <FieldGrid cols={2}>
                    <Field label="Provider">
                        <select className={SELECT} value={provider} onChange={e => setProvider(e.target.value)}>
                            {PROVIDERS.map(p => (
                                <option key={p.value} value={p.value}>{p.label}</option>
                            ))}
                        </select>
                    </Field>
                    <Field label="Address">
                        <input
                            className={INPUT}
                            value={baseUrl}
                            placeholder={placeholder}
                            onChange={e => changeBaseUrl(e.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                        />
                    </Field>
                    <Field label="Model">
                        <input
                            className={INPUT}
                            value={model}
                            placeholder="llama3.1:8b"
                            onChange={e => setModel(e.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                        />
                    </Field>
                    <Field label="API key">
                        <input
                            className={INPUT}
                            type="password"
                            value={apiKey}
                            placeholder={saved?.has_api_key && !clearKey ? 'Saved. Leave blank to keep it.' : 'Optional'}
                            onChange={e => { setApiKey(e.target.value); setClearKey(false); }}
                            autoComplete="new-password"
                        />
                    </Field>
                </FieldGrid>

                {saved?.has_api_key && (
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                        {!saved.api_key_valid && (
                            <span className="text-error">The saved key can&apos;t be read. Enter it again.</span>
                        )}
                        <label className="flex items-center gap-2 text-foreground-secondary cursor-pointer">
                            <input
                                type="checkbox"
                                checked={clearKey}
                                onChange={e => { setClearKey(e.target.checked); if (e.target.checked) setApiKey(''); }}
                                className="w-4 h-4 text-primary bg-background-tertiary border-border-hover rounded focus:ring-primary/50"
                            />
                            Remove the saved key
                        </label>
                    </div>
                )}

                <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                    <input
                        type="checkbox"
                        checked={enabled}
                        onChange={e => setEnabled(e.target.checked)}
                        className="w-4 h-4 text-primary bg-background-tertiary border-border-hover rounded focus:ring-primary/50"
                    />
                    Use this model
                </label>

                <fieldset className="space-y-2">
                    <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-foreground-secondary">
                        What the model sees
                    </legend>
                    {PRIVACY_MODE_OPTIONS.map(option => (
                        <label
                            key={option.value}
                            className={`flex items-start gap-2 rounded-md border p-3 text-sm cursor-pointer transition-colors ${
                                mode === option.value ? 'border-primary bg-primary-light' : 'border-border hover:bg-surface-hover'
                            }`}
                        >
                            <input
                                type="radio"
                                name="ai-privacy-mode"
                                checked={mode === option.value}
                                onChange={() => setMode(option.value)}
                                className="mt-0.5"
                            />
                            <span>
                                <span className="font-medium text-foreground">{option.label}</span>
                                <span className="block text-foreground-muted">{option.what}</span>
                            </span>
                        </label>
                    ))}
                    <p className="text-xs text-foreground-muted">
                        Document extraction (receipts, payslips, statements, documents) is not affected by this
                        setting. It sends the document text whenever a model is set up.
                    </p>
                </fieldset>

                <div className="space-y-1">
                    <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                        <input
                            type="checkbox"
                            checked={selfHosted}
                            onChange={e => setSelfHosted(e.target.checked)}
                            className="w-4 h-4 text-primary bg-background-tertiary border-border-hover rounded focus:ring-primary/50"
                        />
                        This endpoint runs on my own hardware
                    </label>
                    <p className="pl-6 text-xs text-foreground-muted">
                        {cloud
                            ? 'This address belongs to a hosted AI provider, so it always gets the summary only.'
                            : suggested
                                ? 'The address looks local, so this is ticked for you. Untick it if the model runs elsewhere.'
                                : 'Tick this only if the model runs on a machine you control.'}
                    </p>
                    {fullDowngraded && (
                        <p className="pl-6 text-xs text-warning">
                            This endpoint isn&apos;t marked as your own hardware, so it gets the summary only.
                        </p>
                    )}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                        type="button"
                        onClick={test}
                        disabled={busy !== null || !baseUrl.trim() || !model.trim()}
                        className={BUTTON}
                    >
                        {busy === 'test' ? 'Testing…' : 'Test connection'}
                    </button>
                    <button type="button" onClick={save} disabled={busy !== null} className={PRIMARY_BUTTON}>
                        {busy === 'save' ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </div>
        </CollapsibleConfigSection>
    );
}
