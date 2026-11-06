import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { EntityDocument } from '@/lib/services/entity-documents.service';
import EntityDocumentsPage from './page';

const toast = {
  success: vi.fn(),
  error: vi.fn(),
};

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => toast,
}));

interface TestDocumentsResponse {
  documents: EntityDocument[];
  expiringSoon: EntityDocument[];
  warningDays: number;
}

const emptyDocuments: TestDocumentsResponse = {
  documents: [],
  expiringSoon: [],
  warningDays: 60,
};

type ExtraHandler = (url: string, init?: RequestInit) => Response | undefined;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function installFetch(
  entity:
    | {
        entityType: string;
        entityName?: string | null;
        businessActivity?: string;
      }
    | 'error',
  documents: TestDocumentsResponse = emptyDocuments,
  extra?: ExtraHandler
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const handled = extra?.(url, init);
      if (handled) return handled;
      if (url === '/api/entity') {
        return entity === 'error' ? jsonResponse({ error: 'failed' }, 500) : jsonResponse(entity);
      }
      if (url === '/api/business/documents' && (!init?.method || init.method === 'GET')) {
        return jsonResponse(documents);
      }
      throw new Error(`Unexpected request: ${url}`);
    })
  );
}

function legacyDocument(overrides: Partial<EntityDocument> = {}): EntityDocument {
  return {
    id: 9,
    title: 'Legacy articles',
    docType: 'formation',
    fileName: 'articles.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    expiresOn: null,
    issuedOn: null,
    returnCopyDueOn: null,
    notes: null,
    taxYear: null,
    taxForm: null,
    issuer: null,
    uploadedAt: '2026-07-30T00:00:00.000Z',
    daysUntilExpiry: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('EntityDocumentsPage entity context', () => {
  it('shows household copy and removes business-only upload types', async () => {
    installFetch({ entityType: 'household', businessActivity: 'general' });
    render(<EntityDocumentsPage />);

    await screen.findByRole('heading', { name: 'Household Documents' });
    const typeSelect = screen.getByRole('combobox');

    expect(screen.getByPlaceholderText('e.g. Home insurance declaration')).toBeInTheDocument();
    expect(within(typeSelect).getByRole('option', { name: 'Identity records' })).toBeInTheDocument();
    for (const name of [
      'Formation documents',
      'EIN letters',
      'Tax elections',
      'E-595QF certificates',
      'E-595CF certificates',
    ]) {
      expect(within(typeSelect).queryByRole('option', { name })).not.toBeInTheDocument();
    }
  });

  it('shows S-Corp election guidance and relevant upload choices', async () => {
    installFetch({
      entityType: 's_corp',
      entityName: 'Blue Ridge Holdings',
      businessActivity: 'general',
    });
    render(<EntityDocumentsPage />);

    await screen.findByRole('heading', { name: 'S-Corp Documents' });
    const typeSelect = screen.getByRole('combobox');

    expect(screen.getByText(/Blue Ridge Holdings:/)).toHaveTextContent(/formation, election/i);
    expect(screen.getByPlaceholderText('e.g. Form 2553 acceptance letter')).toBeInTheDocument();
    expect(within(typeSelect).getByRole('option', { name: 'Tax elections' })).toBeInTheDocument();
    expect(screen.getByText('Form 2553 and IRS acceptance')).toBeInTheDocument();
  });

  it('emphasizes nonprofit determination, governance, tax, and insurance records', async () => {
    installFetch({
      entityType: 'nonprofit_501c3',
      entityName: 'Community Pantry',
      businessActivity: 'general',
    });
    render(<EntityDocumentsPage />);

    await screen.findByRole('heading', { name: 'Nonprofit Documents' });
    const typeSelect = screen.getByRole('combobox');

    expect(screen.getByText(/Community Pantry:/)).toHaveTextContent(/IRS determination/i);
    expect(screen.getByText('Form 990 and related tax filings')).toBeInTheDocument();
    expect(within(typeSelect).getByRole('option', { name: 'Governance' })).toBeInTheDocument();
    expect(within(typeSelect).getByRole('option', { name: 'IRS determination' })).toBeInTheDocument();
    expect(within(typeSelect).getByRole('option', { name: 'Insurance' })).toBeInTheDocument();
  });

  it('keeps documents visible under neutral copy when the entity request fails', async () => {
    installFetch('error', {
      documents: [legacyDocument()],
      expiringSoon: [],
      warningDays: 60,
    });
    render(<EntityDocumentsPage />);

    await screen.findByText('Legacy articles');
    expect(screen.getByRole('heading', { name: 'Documents' })).toBeInTheDocument();
    expect(screen.getByText('Other document types')).toBeInTheDocument();
    expect(screen.queryByText(/failed to load documents/i)).not.toBeInTheDocument();

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/entity');
      expect(fetch).toHaveBeenCalledWith('/api/business/documents');
    });
  });
});

describe('EntityDocumentsPage empty state', () => {
  it('opens the upload panel on an empty vault and offers a header upload action', async () => {
    installFetch({ entityType: 'household', businessActivity: 'general' });
    render(<EntityDocumentsPage />);

    await screen.findByRole('heading', { name: 'Household Documents' });
    const summary = screen.getByText('Upload documents', { selector: 'summary' });
    expect(summary.closest('details')).toHaveAttribute('open');
    // PageHeader renders actions once for desktop and once for mobile.
    expect(screen.getAllByRole('button', { name: 'Upload documents' }).length).toBeGreaterThan(0);
  });

  it('turns the starter set into buttons that open the form with that category chosen', async () => {
    installFetch({ entityType: 'household', businessActivity: 'general' });
    render(<EntityDocumentsPage />);

    await screen.findByRole('heading', { name: 'Household Documents' });
    const starters = within(
      screen.getByRole('region', { name: /practical starter set/i })
    ).getAllByRole('button');
    expect(starters.map((button) => button.textContent)).toEqual([
      'Identity records',
      'Recent tax filings and notices',
      'Property records',
      'Estate planning documents',
      'Insurance policies',
    ]);

    const insurance = screen.getByRole('button', { name: 'Insurance policies' });
    fireEvent.click(insurance);

    expect(screen.getByLabelText(/^Type/)).toHaveValue('insurance');
    expect(insurance).toHaveAttribute('aria-pressed', 'true');
    // Focus lands on the file picker, so the next keystroke chooses files.
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Choose files' }));
    });
  });

  it('preselects tax and reveals the labelled tax fields from the tax starter', async () => {
    installFetch({ entityType: 'household', businessActivity: 'general' });
    render(<EntityDocumentsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Recent tax filings and notices' }));
    expect(screen.getByLabelText(/^Type/)).toHaveValue('tax');
    expect(screen.getByLabelText('Tax form')).toBeInTheDocument();
    expect(screen.getByLabelText('Tax year')).toBeInTheDocument();
    expect(screen.getByLabelText('Issuer (institution)')).toBeInTheDocument();
  });
});

describe('EntityDocumentsPage upload', () => {
  it('uses a keyboard-reachable picker and stages files with the form metadata until Upload', async () => {
    const posted: FormData[] = [];
    installFetch({ entityType: 'household', businessActivity: 'general' }, emptyDocuments, (url, init) => {
      if (url === '/api/business/documents' && init?.method === 'POST') {
        posted.push(init.body as FormData);
        return jsonResponse({
          document: legacyDocument({ id: 21, title: 'House deed', docType: 'property', fileName: 'deed.pdf' }),
        });
      }
      if (url.startsWith('/api/business/documents/21/suggestions')) {
        return jsonResponse({ extractionStatus: 'completed', suggestionKind: null, suggestions: null });
      }
      return undefined;
    });
    render(<EntityDocumentsPage />);
    await screen.findByRole('heading', { name: 'Household Documents' });

    // The drop surface is a named group with a real, focusable button,
    // not a click-only div.
    const zone = screen.getByRole('group', { name: 'Add documents to upload' });
    const picker = within(zone).getByRole('button', { name: 'Choose files' });
    picker.focus();
    expect(document.activeElement).toBe(picker);
    const input = zone.querySelector('input[type="file"]') as HTMLInputElement;
    const openPicker = vi.spyOn(input, 'click');
    fireEvent.click(picker);
    expect(openPicker).toHaveBeenCalled();

    const file = new File(['%PDF-1.4'], 'deed.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });

    const stagedList = await screen.findByRole('list', { name: 'Files to upload' });
    expect(within(stagedList).getByText('deed.pdf')).toBeInTheDocument();
    // Staging sends nothing.
    expect(posted).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/^Type/), { target: { value: 'property' } });
    fireEvent.change(screen.getByLabelText('Expires (optional)'), { target: { value: '2030-01-31' } });
    fireEvent.change(screen.getByLabelText('Notes (optional)'), { target: { value: 'Recorded copy' } });
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'House deed' } });

    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() => expect(posted).toHaveLength(1));
    const body = posted[0];
    expect((body.get('file') as File).name).toBe('deed.pdf');
    expect(body.get('title')).toBe('House deed');
    expect(body.get('doc_type')).toBe('property');
    expect(body.get('expires_on')).toBe('2030-01-31');
    expect(body.get('notes')).toBe('Recorded copy');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Document uploaded'));
  });

  it('keeps oversized files out of the upload list and says why', async () => {
    installFetch({ entityType: 'household', businessActivity: 'general' });
    render(<EntityDocumentsPage />);
    await screen.findByRole('heading', { name: 'Household Documents' });

    const zone = screen.getByRole('group', { name: 'Add documents to upload' });
    const input = zone.querySelector('input[type="file"]') as HTMLInputElement;
    const huge = new File(['x'], 'scan.pdf', { type: 'application/pdf' });
    Object.defineProperty(huge, 'size', { value: 11 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [huge] } });

    expect(await screen.findByText('exceeds 10MB limit')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Files to upload' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();
  });
});

describe('EntityDocumentsPage errors', () => {
  it('names the load failure with the server message and recovers on Retry', async () => {
    let failNext = true;
    installFetch({ entityType: 'household', businessActivity: 'general' }, emptyDocuments, (url, init) => {
      if (url === '/api/business/documents' && (!init?.method || init.method === 'GET') && failNext) {
        failNext = false;
        return jsonResponse({ error: 'Database unavailable' }, 503);
      }
      return undefined;
    });
    render(<EntityDocumentsPage />);

    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(
      screen.getByText(/Couldn't load your documents: Database unavailable\./, { selector: 'p' })
    ).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: 'Upload documents' })).toHaveLength(0);

    fireEvent.click(retry);
    expect(await screen.findByRole('button', { name: 'Insurance policies' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('warns that delete is permanent and reports the server reason when it fails', async () => {
    installFetch(
      { entityType: 'household', businessActivity: 'general' },
      {
        documents: [legacyDocument({ docType: 'property', title: 'House deed' })],
        expiringSoon: [],
        warningDays: 60,
      },
      (url, init) => {
        if (url === '/api/business/documents/9' && init?.method === 'DELETE') {
          return jsonResponse({ error: 'Storage backend offline' }, 500);
        }
        return undefined;
      }
    );
    render(<EntityDocumentsPage />);

    await screen.findByText('House deed', { selector: 'button' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const confirm = screen.getByRole('group', { name: 'Delete House deed?' });
    expect(confirm).toHaveTextContent("This removes the file from storage. It can't be recovered.");
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete permanently' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Couldn't delete “House deed”: Storage backend offline. It is still in the vault; try again."
      );
    });
  });
});
