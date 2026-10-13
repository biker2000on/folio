import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePayslipUpload } from '../PayslipUploadZone';

afterEach(() => vi.restoreAllMocks());

const pdf = (name: string) => new File(['%PDF-1.4'], name, { type: 'application/pdf' });

describe('usePayslipUpload', () => {
  it('uploads only the PDFs and flags everything else', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ results: [{ id: 7, filename: 'a.pdf', status: 'uploaded' }] }), { status: 200 }),
    );
    const done = vi.fn();
    const { result } = renderHook(() => usePayslipUpload(done));

    await act(async () => {
      await result.current.uploadFiles([pdf('a.pdf'), new File(['x'], 'notes.txt', { type: 'text/plain' })]);
    });

    const body = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(body.getAll('files').map((f) => (f as File).name)).toEqual(['a.pdf']);
    expect(done).toHaveBeenCalledWith([{ id: 7, filename: 'a.pdf', status: 'uploaded' }]);
    expect(result.current.uploads).toEqual([
      { filename: 'a.pdf', status: 'success', message: 'Processing…' },
      { filename: 'notes.txt', status: 'error', message: 'Not a PDF' },
    ]);
  });

  it('does not call the API when nothing is a PDF', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const { result } = renderHook(() => usePayslipUpload());
    await act(async () => {
      await result.current.uploadFiles([new File(['x'], 'pic.png', { type: 'image/png' })]);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.uploads[0]).toMatchObject({ status: 'error', message: 'Not a PDF' });
  });
});
