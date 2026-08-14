import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiSettingsResponse } from "@/contracts/api";

const api = vi.hoisted(() => ({
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
  credentialSource: "platform",
  credentialConfigured: true,
  platformCredentials: { openai: true, openrouter: false },
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
      credentialSource: "household",
      credentialConfigured: true,
    });
    render(<AiProviderSettings apiMode="connected" />);

    await screen.findByLabelText("Provider");

    expect(api.getAiSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Provider")).toHaveValue("openrouter");
    expect(screen.getByLabelText("Vision model")).toHaveValue(
      "acme/custom-vision-v3",
    );
    expect(screen.getByLabelText("Recipe model")).toHaveValue(
      "acme/custom-recipe-v7",
    );
    expect(screen.getByRole("radio", { name: /Household key/i })).toBeChecked();
    expect(screen.getByLabelText("Replace OpenRouter API key")).toHaveValue("");
  });

  it("submits a household OpenRouter key once, then clears it from the UI and browser storage", async () => {
    const user = userEvent.setup();
    api.updateAiSettings.mockResolvedValue({
      ...initial,
      provider: "openrouter",
      visionModelId: "vendor/vision",
      recipeModelId: "vendor/recipes",
      credentialSource: "household",
      credentialConfigured: true,
      version: 2,
    });

    render(<AiProviderSettings apiMode="connected" />);
    await screen.findByRole("option", { name: "OpenRouter" });
    await user.selectOptions(screen.getByLabelText("Provider"), "openrouter");
    await user.click(screen.getByRole("radio", { name: /Household key/i }));
    const secret = "fake-openrouter-household-key";
    await user.type(screen.getByLabelText("OpenRouter API key"), secret);
    await user.click(screen.getByRole("button", { name: "Save AI provider" }));

    await waitFor(() => {
      expect(api.updateAiSettings).toHaveBeenCalledWith({
        provider: "openrouter",
        visionModelId: "vendor/vision",
        recipeModelId: "vendor/recipes",
        credentialSource: "household",
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

  it("shows members the route without rendering an editable secret", async () => {
    api.getAiSettings.mockResolvedValue({
      ...initial,
      credentialSource: "household",
      credentialConfigured: true,
      canEdit: false,
    });
    render(<AiProviderSettings apiMode="connected" />);

    await screen.findByText("Owner-managed setting");
    expect(screen.getByLabelText("Provider")).toBeDisabled();
    expect(screen.getByLabelText("Replace OpenAI API key")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save AI provider" })).toBeNull();
  });

  it("automatically loads visible OpenRouter choices after a household key is entered", async () => {
    const user = userEvent.setup();
    render(<AiProviderSettings apiMode="connected" />);

    await screen.findByRole("option", { name: "OpenRouter" });
    await user.selectOptions(screen.getByLabelText("Provider"), "openrouter");
    await user.click(screen.getByRole("radio", { name: /Household key/i }));
    await user.type(
      screen.getByLabelText("OpenRouter API key"),
      "fake-openrouter-discovery-key",
    );

    await waitFor(
      () => {
        expect(api.discoverOpenRouterModelChoices).toHaveBeenCalledWith({
          credentialSource: "household",
          apiKey: "fake-openrouter-discovery-key",
        });
      },
      { timeout: 2500 },
    );
    await screen.findByText(/2 structured-output models loaded; 1 accept photos/i);

    const visionField = screen.getByLabelText("Vision model");
    const visionChoices = screen.getByLabelText("Vision model choices");
    expect(visionChoices).toBeVisible();
    await user.selectOptions(visionChoices, "vendor/vision-ready");
    expect(visionField).toHaveValue("vendor/vision-ready");
  });

  it("provides a direct model-load action when automatic loading has not run", async () => {
    const user = userEvent.setup();
    render(<AiProviderSettings apiMode="connected" />);

    await screen.findByRole("option", { name: "OpenRouter" });
    await user.selectOptions(screen.getByLabelText("Provider"), "openrouter");
    await user.click(screen.getByRole("radio", { name: /Household key/i }));
    await user.type(screen.getByLabelText("OpenRouter API key"), "fake-key");
    await user.click(screen.getByRole("button", { name: "Load models" }));

    await waitFor(() => {
      expect(api.discoverOpenRouterModelChoices).toHaveBeenCalledWith({
        credentialSource: "household",
        apiKey: "fake-key",
      });
    });
    expect(await screen.findByLabelText("Recipe model choices")).toBeVisible();
  });

  it("uses an already-saved OpenRouter key without asking the browser for it again", async () => {
    api.getAiSettings.mockResolvedValue({
      ...initial,
      provider: "openrouter",
      visionModelId: "vendor/vision",
      recipeModelId: "vendor/recipe",
      credentialSource: "household",
      credentialConfigured: true,
    });
    render(<AiProviderSettings apiMode="connected" />);

    await waitFor(() => {
      expect(api.discoverOpenRouterModelChoices).toHaveBeenCalledWith({
        credentialSource: "household",
      });
    });
    expect(screen.getByLabelText("Replace OpenRouter API key")).toHaveValue("");
  });
});
