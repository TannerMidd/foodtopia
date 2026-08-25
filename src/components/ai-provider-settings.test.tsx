import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiSettingsResponse } from "@/contracts/api";

const api = vi.hoisted(() => ({
  ApiClientError: class ApiClientError extends Error {
    readonly status: number;
    readonly code: string;
    readonly retryable: boolean;
    readonly correlationId: string | null;

    constructor(options: { message: string; code: string; status: number }) {
      super(options.message);
      this.name = "ApiClientError";
      this.status = options.status;
      this.code = options.code;
      this.retryable = false;
      this.correlationId = null;
    }
  },
  discoverOpenRouterModelChoices: vi.fn(),
  getAiSettings: vi.fn(),
  updateAiSettings: vi.fn(),
}));

vi.mock("@/lib/client/api", () => api);

import { AiProviderSettings } from "./ai-provider-settings";

const initial: AiSettingsResponse = {
  provider: "openai",
  visionModelId: "gpt-vision",
  recipeModelId: "gpt-recipes",
  credentialConfigured: true,
  modelDefaults: {
    openai: {
      visionModelId: "gpt-vision",
      recipeModelId: "gpt-recipes",
    },
    openrouter: {
      visionModelId: "vendor/vision",
      recipeModelId: "vendor/recipes",
    },
  },
  householdCredentialsAvailable: true,
  canEdit: true,
  updatedAt: "2026-08-14T12:00:00.000Z",
  version: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  api.getAiSettings.mockResolvedValue(initial);
  api.discoverOpenRouterModelChoices.mockResolvedValue({
    models: [
      {
        id: "vendor/vision-ready",
        name: "Vision Ready",
        contextLength: 131072,
        supportsVision: true,
      },
      {
        id: "vendor/recipe-ready",
        name: "Recipe Ready",
        contextLength: 65536,
        supportsVision: false,
      },
    ],
    fetchedAt: "2026-08-14T18:00:00.000Z",
  });
});

describe("AI provider settings", () => {
  it("hydrates every saved provider selection from GET without exposing the key", async () => {
    api.getAiSettings.mockResolvedValue({
      ...initial,
      provider: "openrouter",
      visionModelId: "acme/custom-vision-v3",
      recipeModelId: "acme/custom-recipe-v7",
      credentialConfigured: true,
    });
    render(<AiProviderSettings apiMode="connected" />);

    await screen.findByLabelText("Provider");

    expect(api.getAiSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Provider")).toHaveValue("openrouter");
    expect(screen.getByLabelText("Custom vision model ID")).toHaveValue(
      "acme/custom-vision-v3",
    );
    expect(screen.getByLabelText("Custom recipe model ID")).toHaveValue(
      "acme/custom-recipe-v7",
    );
    expect(screen.getByLabelText("Replace OpenRouter API key")).toHaveValue("");
  });

  it("submits a household OpenRouter key once, then clears it from the UI and browser storage", async () => {
    const user = userEvent.setup();
    api.updateAiSettings.mockResolvedValue({
      ...initial,
      provider: "openrouter",
      visionModelId: "vendor/vision",
      recipeModelId: "vendor/recipes",
      credentialConfigured: true,
      version: 2,
    });

    render(<AiProviderSettings apiMode="connected" />);
    await screen.findByRole("option", { name: "OpenRouter" });
    await user.selectOptions(screen.getByLabelText("Provider"), "openrouter");
    const secret = "fake-openrouter-household-key";
    await user.type(screen.getByLabelText("OpenRouter API key"), secret);
    await user.click(screen.getByRole("button", { name: "Save AI provider" }));

    await waitFor(() => {
      expect(api.updateAiSettings).toHaveBeenCalledWith({
        provider: "openrouter",
        visionModelId: "vendor/vision",
        recipeModelId: "vendor/recipes",
        credentialAction: "replace",
        expectedVersion: 1,
        apiKey: secret,
      });
    });
    expect(screen.getByLabelText("Replace OpenRouter API key")).toHaveValue("");
    expect(document.body.textContent).not.toContain(secret);
    expect(JSON.stringify(localStorage)).not.toContain(secret);
    expect(JSON.stringify(sessionStorage)).not.toContain(secret);
  });

  it("retains the saved key when saving without re-entering it", async () => {
    const user = userEvent.setup();
    render(<AiProviderSettings apiMode="connected" />);
    await screen.findByLabelText("Replace OpenAI API key");

    await user.click(screen.getByRole("button", { name: "Save AI provider" }));

    await waitFor(() => {
      expect(api.updateAiSettings).toHaveBeenCalledWith(
        expect.not.objectContaining({ credentialAction: "replace" }),
      );
    });
    expect(api.updateAiSettings).toHaveBeenCalledWith(
      expect.objectContaining({ credentialAction: "retain" }),
    );
  });

  it("requires a fresh key after switching providers with a saved key", async () => {
    const user = userEvent.setup();
    render(<AiProviderSettings apiMode="connected" />);
    await screen.findByLabelText("Replace OpenAI API key");

    await user.selectOptions(screen.getByLabelText("Provider"), "openrouter");
    await user.type(screen.getByLabelText("OpenRouter API key"), "brand-new-key");
    await user.click(screen.getByRole("button", { name: "Save AI provider" }));

    await waitFor(() => {
      expect(api.updateAiSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "openrouter",
          credentialAction: "replace",
          apiKey: "brand-new-key",
        }),
      );
    });
  });

  it("removes a saved key with an explicit clear action", async () => {
    const user = userEvent.setup();
    api.updateAiSettings.mockResolvedValue({
      ...initial,
      credentialConfigured: false,
      version: 2,
    });
    render(<AiProviderSettings apiMode="connected" />);
    await screen.findByLabelText("Replace OpenAI API key");

    await user.click(screen.getByRole("button", { name: "Remove saved key" }));

    await waitFor(() => {
      expect(api.updateAiSettings).toHaveBeenCalledWith(
        expect.objectContaining({ credentialAction: "clear" }),
      );
    });
  });

  it("shows members the route without rendering an editable secret", async () => {
    api.getAiSettings.mockResolvedValue({
      ...initial,
      credentialConfigured: true,
      canEdit: false,
    });
    render(<AiProviderSettings apiMode="connected" />);

    await screen.findByText("Owner-managed setting");
    expect(screen.getByLabelText("Provider")).toBeDisabled();
    expect(screen.getByLabelText("Replace OpenAI API key")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save AI provider" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove saved key" })).toBeNull();
  });

  it("automatically loads visible OpenRouter choices after a household key is entered", async () => {
    const user = userEvent.setup();
    render(<AiProviderSettings apiMode="connected" />);

    await screen.findByRole("option", { name: "OpenRouter" });
    await user.selectOptions(screen.getByLabelText("Provider"), "openrouter");
    await user.type(
      screen.getByLabelText("OpenRouter API key"),
      "fake-openrouter-discovery-key",
    );

    await waitFor(
      () => {
        expect(api.discoverOpenRouterModelChoices).toHaveBeenCalledWith({
          apiKey: "fake-openrouter-discovery-key",
        });
      },
      { timeout: 2500 },
    );
    await screen.findByText(/2 structured-output models loaded; 1 accept photos/i);

    const visionField = screen.getByLabelText("Custom vision model ID");
    const visionSearch = screen.getByLabelText("Search vision models");
    expect(visionSearch).toBeVisible();
    await user.type(visionSearch, "vision ready");
    await user.click(
      within(screen.getByLabelText("Vision model search results")).getByRole(
        "button",
        { name: /Vision Ready/i },
      ),
    );
    expect(visionField).toHaveValue("vendor/vision-ready");
  });

  it("provides a direct model-load action when automatic loading has not run", async () => {
    const user = userEvent.setup();
    render(<AiProviderSettings apiMode="connected" />);

    await screen.findByRole("option", { name: "OpenRouter" });
    await user.selectOptions(screen.getByLabelText("Provider"), "openrouter");
    await user.type(screen.getByLabelText("OpenRouter API key"), "fake-key");
    await user.click(screen.getByRole("button", { name: "Load models" }));

    await waitFor(() => {
      expect(api.discoverOpenRouterModelChoices).toHaveBeenCalledWith({
        apiKey: "fake-key",
      });
    });
    expect(await screen.findByLabelText("Search recipe models")).toBeVisible();
  });

  it("uses an already-saved OpenRouter key without asking the browser for it again", async () => {
    api.getAiSettings.mockResolvedValue({
      ...initial,
      provider: "openrouter",
      visionModelId: "vendor/vision",
      recipeModelId: "vendor/recipe",
      credentialConfigured: true,
    });
    render(<AiProviderSettings apiMode="connected" />);

    await waitFor(() => {
      expect(api.discoverOpenRouterModelChoices).toHaveBeenCalledWith({});
    });
    expect(screen.getByLabelText("Replace OpenRouter API key")).toHaveValue("");
  });

  it("reloads a stale settings version while preserving model choices for retry", async () => {
    const user = userEvent.setup();
    const saved = {
      ...initial,
      provider: "openrouter" as const,
      visionModelId: "vendor/vision-ready",
      recipeModelId: "vendor/recipe-ready",
      credentialConfigured: true,
      version: 4,
    };
    api.getAiSettings
      .mockResolvedValueOnce(saved)
      .mockResolvedValueOnce({ ...saved, version: 5 });
    api.updateAiSettings.mockRejectedValue(
      new api.ApiClientError({
        status: 409,
        code: "VERSION_CONFLICT",
        message: "This item changed on another device.",
      }),
    );

    render(<AiProviderSettings apiMode="connected" />);
    await screen.findByLabelText("Search vision models");
    await user.click(screen.getByRole("button", { name: "Save AI provider" }));

    await screen.findByText(/latest version is loaded/i);
    expect(api.getAiSettings).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Custom vision model ID")).toHaveValue(
      "vendor/vision-ready",
    );
  });

  it("searches hundreds of models without rendering one enormous native select", async () => {
    const user = userEvent.setup();
    const models = Array.from({ length: 240 }, (_, index) => ({
      id: `vendor/model~alias-${index}`,
      name: `Model ${index}`,
      contextLength: 128_000 + index,
      supportsVision: index % 2 === 0,
    }));
    api.getAiSettings.mockResolvedValue({
      ...initial,
      provider: "openrouter",
      visionModelId: models[0].id,
      recipeModelId: models[1].id,
      credentialConfigured: true,
    });
    api.discoverOpenRouterModelChoices.mockResolvedValue({
      models,
      fetchedAt: "2026-08-14T18:00:00.000Z",
    });

    render(<AiProviderSettings apiMode="connected" />);
    const recipeSearch = await screen.findByLabelText("Search recipe models");
    expect(screen.queryByLabelText("Recipe model choices")).toBeNull();
    expect(screen.getByText(/Showing 20 of 240 matches/i)).toBeInTheDocument();

    await user.type(recipeSearch, "model 199");
    expect(screen.getByRole("button", { name: /Model 199/i })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Model 198/i })).toBeNull();
  });

  it("saves discovered OpenRouter alias IDs containing a tilde with the retained key", async () => {
    const user = userEvent.setup();
    const aliasSettings = {
      ...initial,
      provider: "openrouter" as const,
      visionModelId: "vendor/current-vision",
      recipeModelId: "vendor/current-recipe",
      credentialConfigured: true,
      version: 7,
    };
    api.getAiSettings.mockResolvedValue(aliasSettings);
    api.discoverOpenRouterModelChoices.mockResolvedValue({
      models: [
        {
          id: "vendor/model~vision-alias",
          name: "Vision Alias",
          contextLength: 128_000,
          supportsVision: true,
        },
        {
          id: "vendor/model~recipe-alias",
          name: "Recipe Alias",
          contextLength: 64_000,
          supportsVision: false,
        },
      ],
      fetchedAt: "2026-08-14T18:00:00.000Z",
    });
    api.updateAiSettings.mockResolvedValue({
      ...aliasSettings,
      visionModelId: "vendor/model~vision-alias",
      recipeModelId: "vendor/model~recipe-alias",
      version: 8,
    });

    render(<AiProviderSettings apiMode="connected" />);
    await user.type(await screen.findByLabelText("Search vision models"), "Vision Alias");
    await user.click(
      within(screen.getByLabelText("Vision model search results")).getByRole(
        "button",
        { name: /Vision Alias/i },
      ),
    );
    await user.type(screen.getByLabelText("Search recipe models"), "Recipe Alias");
    await user.click(
      within(screen.getByLabelText("Recipe model search results")).getByRole(
        "button",
        { name: /Recipe Alias/i },
      ),
    );
    await user.click(screen.getByRole("button", { name: "Save AI provider" }));

    await waitFor(() => {
      expect(api.updateAiSettings).toHaveBeenCalledWith({
        provider: "openrouter",
        visionModelId: "vendor/model~vision-alias",
        recipeModelId: "vendor/model~recipe-alias",
        credentialAction: "retain",
        expectedVersion: 7,
      });
    });
  });
});
