import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmSettingsSection } from './LlmSettingsSection';
import type { LlmCatalogResponse } from '@/lib/llm/types';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

const addToastMock = vi.fn();
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

const fetchCatalogMock = vi.fn();
const updateSelectionMock = vi.fn();
const setCredentialMock = vi.fn();
const deleteCredentialMock = vi.fn();
// Stable identity — the component keys callbacks off the hook's result.
const llmApiMock = {
  fetchCatalog: fetchCatalogMock,
  updateSelection: updateSelectionMock,
  setCredential: setCredentialMock,
  deleteCredential: deleteCredentialMock,
};
vi.mock('@/lib/llm/use-llm-api', () => ({
  useLlmApi: () => llmApiMock,
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const catalog = (over: Partial<LlmCatalogResponse> = {}): LlmCatalogResponse => ({
  models: [
    {
      provider: 'anthropic',
      id: 'claude-sonnet-5',
      label: 'Anthropic Claude Sonnet 5',
      available: true,
    },
    {
      provider: 'anthropic',
      id: 'claude-haiku-4-5',
      label: 'Anthropic Claude Haiku 4.5',
      available: true,
    },
    { provider: 'openai', id: 'gpt-5.6', label: 'OpenAI GPT-5.6', available: false },
  ],
  selection: null,
  credentials: [],
  sharedProviders: ['anthropic'],
  ...over,
});

describe('LlmSettingsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchCatalogMock.mockResolvedValue(catalog());
  });

  it('renders the catalog: available models enabled, keyless ones disabled', async () => {
    render(<LlmSettingsSection />);
    const select = await screen.findByTestId('llm-model-select');

    const sonnet = screen.getByRole('option', { name: /Claude Sonnet 5/ }) as HTMLOptionElement;
    const gpt = screen.getByRole('option', { name: /GPT-5.6/ }) as HTMLOptionElement;
    expect(sonnet.disabled).toBe(false);
    expect(gpt.disabled).toBe(true);
    expect((select as HTMLSelectElement).value).toBe(''); // server default
  });

  it('shows the stored selection and key hints', async () => {
    fetchCatalogMock.mockResolvedValue(
      catalog({
        selection: { provider: 'anthropic', model: 'claude-sonnet-5' },
        credentials: [{ provider: 'openai', keyHint: 'cdef', updatedAt: '2026-07-12T00:00:00Z' }],
      }),
    );
    render(<LlmSettingsSection />);

    await waitFor(() =>
      expect((screen.getByTestId('llm-model-select') as HTMLSelectElement).value).toBe(
        'anthropic::claude-sonnet-5',
      ),
    );
    expect(screen.getByTestId('llm-key-status-openai')).toHaveTextContent('cdef');
    expect(screen.getByTestId('llm-delete-key-openai')).toBeInTheDocument();
    // Anthropic runs on the shared key — no personal key stored.
    expect(screen.getByTestId('llm-key-status-anthropic')).toHaveTextContent('sharedAvailable');
  });

  it('saves a model selection and reloads the catalog', async () => {
    updateSelectionMock.mockResolvedValue({ provider: 'anthropic', model: 'claude-sonnet-5' });
    render(<LlmSettingsSection />);
    const select = await screen.findByTestId('llm-model-select');

    fireEvent.change(select, { target: { value: 'anthropic::claude-sonnet-5' } });
    fireEvent.click(screen.getByTestId('llm-save-model'));

    await waitFor(() =>
      expect(updateSelectionMock).toHaveBeenCalledWith(
        'anthropic',
        'claude-sonnet-5',
        expect.anything(),
      ),
    );
    await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('success', 'modelSaved'));
    expect(fetchCatalogMock).toHaveBeenCalledTimes(2);
  });

  it('clears back to the server default with a null pair', async () => {
    fetchCatalogMock.mockResolvedValue(
      catalog({ selection: { provider: 'anthropic', model: 'claude-sonnet-5' } }),
    );
    updateSelectionMock.mockResolvedValue(null);
    render(<LlmSettingsSection />);
    const select = await screen.findByTestId('llm-model-select');
    await waitFor(() =>
      expect((select as HTMLSelectElement).value).toBe('anthropic::claude-sonnet-5'),
    );

    fireEvent.change(select, { target: { value: '' } });
    fireEvent.click(screen.getByTestId('llm-save-model'));
    await waitFor(() =>
      expect(updateSelectionMock).toHaveBeenCalledWith(null, null, expect.anything()),
    );
  });

  it('saves an API key and clears the input', async () => {
    setCredentialMock.mockResolvedValue({
      provider: 'openai',
      keyHint: 'wxyz',
      updatedAt: '2026-07-12T00:00:00Z',
    });
    render(<LlmSettingsSection />);
    const input = await screen.findByTestId('llm-key-input-openai');

    fireEvent.change(input, { target: { value: 'sk-proj-abcdefghijklmnopqrstuvwxyz' } });
    fireEvent.click(screen.getByTestId('llm-save-key-openai'));

    await waitFor(() =>
      expect(setCredentialMock).toHaveBeenCalledWith(
        'openai',
        'sk-proj-abcdefghijklmnopqrstuvwxyz',
        expect.anything(),
      ),
    );
    await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('success', 'keySaved'));
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('maps a 401 on credential writes to the re-authentication message', async () => {
    const err = new Error('Please sign in again') as Error & { status?: number };
    err.status = 401;
    setCredentialMock.mockRejectedValue(err);
    render(<LlmSettingsSection />);
    const input = await screen.findByTestId('llm-key-input-openai');

    fireEvent.change(input, { target: { value: 'sk-proj-abcdefghijklmnopqrstuvwxyz' } });
    fireEvent.click(screen.getByTestId('llm-save-key-openai'));

    await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('error', 'reauthRequired'));
  });

  it('deletes a stored key', async () => {
    fetchCatalogMock.mockResolvedValue(
      catalog({
        credentials: [{ provider: 'openai', keyHint: 'cdef', updatedAt: '2026-07-12T00:00:00Z' }],
      }),
    );
    deleteCredentialMock.mockResolvedValue(undefined);
    render(<LlmSettingsSection />);

    fireEvent.click(await screen.findByTestId('llm-delete-key-openai'));
    await waitFor(() =>
      expect(deleteCredentialMock).toHaveBeenCalledWith('openai', expect.anything()),
    );
    await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('success', 'keyDeleted'));
  });
});
