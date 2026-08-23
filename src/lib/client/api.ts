import {
  aiSettingsResponseSchema,
  accountStatusResponseSchema,
  analysisCreateResponseSchema,
  analysisResponseSchema,
  apiErrorSchema,
  betaAccountMutationResponseSchema,
  betaAccountsResponseSchema,
  cookSessionCreateResponseSchema,
  householdBootstrapResponseSchema,
  householdCurrentResponseSchema,
  householdDeleteResponseSchema,
  householdInviteAcceptResponseSchema,
  householdMemberRemoveResponseSchema,
  householdMembersResponseSchema,
  inventoryCommandResponseSchema,
  inventorySyncResponseSchema,
  inviteCreateResponseSchema,
  openRouterModelsResponseSchema,
  recipeSuggestionResponseSchema,
  signupWindowResponseSchema,
  unfinishedAnalysesResponseSchema,
  visionConsentResponseSchema,
  type AccountStatus,
  type AiSettingsResponse,
  type AiSettingsUpdateRequest,
  type AnalysisCreateResponse,
  type BetaAccountsResponse,
  type InventorySyncResponse,
  type OpenRouterModelDiscoveryRequest,
  type OpenRouterModelsResponse,
  type RecipeSuggestionResponse,
} from "@/contracts/api";
import type {
  Analysis,
  AnalysisCandidate,
  InventoryCommand,
  InventoryLot,
  RecipeAssessment,
} from "@/contracts/domain";
import {
  householdPreferencesSchema,
  type HouseholdPreferences,
} from "@/contracts/domain";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly correlationId: string | null;

  constructor(options: {
    message: string;
    status: number;
    code?: string;
    retryable?: boolean;
    correlationId?: string | null;
  }) {
    super(options.message);
    this.name = "ApiClientError";
    this.status = options.status;
    this.code = options.code ?? "request_failed";
    this.retryable = options.retryable ?? (options.status === 0 || options.status >= 500);
    this.correlationId = options.correlationId ?? null;
  }
}

let observedMode: "connected" | "demo" = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? "connected"
  : "demo";

export function getObservedApiMode() {
  return observedMode;
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      credentials: "include",
      cache: "no-store",
    });
  } catch (error) {
    throw new ApiClientError({
      message: error instanceof Error ? error.message : "Could not reach Foodtopia.",
      status: 0,
      code: "network_unavailable",
      retryable: true,
    });
  }

  if (response.headers.get("x-foodtopia-mode") === "demo") observedMode = "demo";
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    throw new ApiClientError({
      status: response.status,
      message: parsed.success ? parsed.data.message : `Request failed (${response.status}).`,
      code: parsed.success ? parsed.data.code : "request_failed",
      retryable: parsed.success ? parsed.data.retryable : response.status >= 500,
      correlationId: parsed.success ? parsed.data.correlationId : null,
    });
  }

  return body;
}

export async function syncInventory(cursor?: string | null): Promise<InventorySyncResponse> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return inventorySyncResponseSchema.parse(await request(`/api/v1/inventory/sync${query}`));
}

export async function sendInventoryCommand(command: InventoryCommand): Promise<InventoryLot> {
  const parsed = inventoryCommandResponseSchema.parse(
    await request("/api/v1/inventory/commands", {
      method: "POST",
      body: JSON.stringify({ command }),
    }),
  );
  return parsed.lot;
}

export async function createHouseholdInvite(email: string) {
  return inviteCreateResponseSchema.parse(
    await request("/api/v1/household-invites", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  );
}

export async function acceptHouseholdInvite(token: string) {
  return householdInviteAcceptResponseSchema.parse(
    await request("/api/v1/household-invites/accept", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  );
}

export async function bootstrapHousehold(name: string, betaToken: string) {
  return householdBootstrapResponseSchema.parse(
    await request("/api/v1/households/bootstrap", {
      method: "POST",
      body: JSON.stringify({ name, betaToken }),
    }),
  );
}

export async function getAccountStatus(): Promise<AccountStatus> {
  return accountStatusResponseSchema.parse(
    await request("/api/v1/auth/account-status"),
  ).status;
}

export async function listBetaAccounts(): Promise<BetaAccountsResponse> {
  return betaAccountsResponseSchema.parse(
    await request("/api/v1/admin/beta-accounts"),
  );
}

export async function enableBetaAccounts(userIds: string[]) {
  return betaAccountMutationResponseSchema.parse(
    await request("/api/v1/admin/beta-accounts/enable", {
      method: "POST",
      body: JSON.stringify({ userIds }),
    }),
  );
}

export async function disableBetaAccounts(userIds: string[]) {
  return betaAccountMutationResponseSchema.parse(
    await request("/api/v1/admin/beta-accounts/disable", {
      method: "POST",
      body: JSON.stringify({ userIds }),
    }),
  );
}

export async function setSignupWindow(open: boolean) {
  return signupWindowResponseSchema.parse(
    await request("/api/v1/admin/beta-signup-window", {
      method: "POST",
      body: JSON.stringify({ open }),
    }),
  );
}

export async function getCurrentHousehold() {
  return householdCurrentResponseSchema.parse(
    await request("/api/v1/households/current"),
  );
}

export async function getVisionConsent() {
  return visionConsentResponseSchema.parse(
    await request("/api/v1/consents/vision"),
  );
}

export async function grantVisionConsent() {
  return visionConsentResponseSchema.parse(
    await request("/api/v1/consents/vision", { method: "POST" }),
  );
}

export async function getAiSettings(): Promise<AiSettingsResponse> {
  return aiSettingsResponseSchema.parse(await request("/api/v1/ai-settings"));
}

export async function updateAiSettings(
  settings: AiSettingsUpdateRequest,
): Promise<AiSettingsResponse> {
  return aiSettingsResponseSchema.parse(
    await request("/api/v1/ai-settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
  );
}

export async function discoverOpenRouterModelChoices(
  input: OpenRouterModelDiscoveryRequest,
): Promise<OpenRouterModelsResponse> {
  return openRouterModelsResponseSchema.parse(
    await request("/api/v1/ai-settings/openrouter-models", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
}

export async function getHouseholdPreferences(): Promise<HouseholdPreferences> {
  return householdPreferencesSchema.parse(await request("/api/v1/preferences"));
}

export async function updateHouseholdPreferences(
  preferences: HouseholdPreferences,
): Promise<HouseholdPreferences> {
  return householdPreferencesSchema.parse(
    await request("/api/v1/preferences", {
      method: "PUT",
      body: JSON.stringify(preferences),
    }),
  );
}

export async function getHouseholdMembers() {
  return householdMembersResponseSchema.parse(
    await request("/api/v1/household-members"),
  );
}

export async function removeHouseholdMember(userId: string) {
  return householdMemberRemoveResponseSchema.parse(
    await request(`/api/v1/household-members/${encodeURIComponent(userId)}`, {
      method: "DELETE",
    }),
  );
}

export async function deleteCurrentHousehold() {
  return householdDeleteResponseSchema.parse(
    await request("/api/v1/households/current", { method: "DELETE" }),
  );
}

export async function recordRecipeOpened() {
  try {
    await request("/api/v1/product-events", {
      method: "POST",
      body: JSON.stringify({
        name: "recipe_opened",
        properties: {},
      }),
    });
  } catch {
    // Privacy-safe product telemetry is best-effort and never blocks cooking.
  }
}

export async function getRecipeSuggestions(prompt: string): Promise<RecipeSuggestionResponse> {
  return recipeSuggestionResponseSchema.parse(
    await request("/api/v1/recipe-suggestions", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),
  );
}

export async function createAnalysis(files: File[]): Promise<AnalysisCreateResponse> {
  return analysisCreateResponseSchema.parse(
    await request("/api/v1/analyses", {
      method: "POST",
      body: JSON.stringify({
        imageCount: files.length,
        files: files.map((file) => ({
          name: file.name,
          contentType: "image/jpeg" as const,
          size: file.size,
        })),
      }),
    }),
  );
}

export async function getUnfinishedAnalyses() {
  return unfinishedAnalysesResponseSchema.parse(
    await request("/api/v1/analyses"),
  );
}

export async function uploadAnalysisFiles(
  created: AnalysisCreateResponse,
  files: File[],
): Promise<string[]> {
  if (created.uploads.length !== files.length) {
    throw new ApiClientError({
      status: 500,
      code: "upload_descriptor_mismatch",
      message: "The upload could not be prepared. Please start a new batch.",
    });
  }

  if (created.uploadMode === "signed") {
    await Promise.all(
      created.uploads.map(async (upload, index) => {
        if (!upload.signedUrl) {
          throw new ApiClientError({
            status: 500,
            code: "missing_signed_url",
            message: "The private upload link was missing. Please try again.",
          });
        }
        const signedUrl = new URL(upload.signedUrl);
        if (upload.token && !signedUrl.searchParams.has("token")) {
          signedUrl.searchParams.set("token", upload.token);
        }
        const body = new FormData();
        body.append("cacheControl", "0");
        body.append("", files[index]);
        const result = await fetch(signedUrl.toString(), {
          method: "PUT",
          headers: { "x-upsert": "false" },
          body,
        });
        if (!result.ok) {
          throw new ApiClientError({
            status: result.status,
            code: "private_upload_failed",
            message: "One of the photos did not upload. Your inventory was not changed.",
            retryable: result.status >= 500,
          });
        }
      }),
    );
  }

  return created.uploads.map((upload) => upload.assetId);
}

export async function completeAnalysis(analysisId: string, assetIds: string[]): Promise<Analysis> {
  return analysisResponseSchema.parse(
    await request(`/api/v1/analyses/${encodeURIComponent(analysisId)}/complete`, {
      method: "POST",
      body: JSON.stringify({ assetIds }),
    }),
  );
}

export async function getAnalysis(analysisId: string): Promise<Analysis> {
  return analysisResponseSchema.parse(
    await request(`/api/v1/analyses/${encodeURIComponent(analysisId)}`),
  );
}

export async function cancelAnalysis(analysisId: string): Promise<void> {
  await request(`/api/v1/analyses/${encodeURIComponent(analysisId)}`, {
    method: "DELETE",
  });
}

export async function applyAnalysis(
  analysisId: string,
  candidates: AnalysisCandidate[],
): Promise<unknown> {
  return request(`/api/v1/analyses/${encodeURIComponent(analysisId)}/apply`, {
    method: "POST",
    body: JSON.stringify({ candidates }),
  });
}

export type ReconciliationChange = {
  ingredientId: string;
  lotId: string;
  action: "no_change" | "used_some" | "used_up";
  quantity: number | null;
  unit: string | null;
  expectedVersion: number;
};

export async function createCookSession(
  assessment: RecipeAssessment,
): Promise<{ cookSessionId: string; recipeId: string; createdAt: string }> {
  return cookSessionCreateResponseSchema.parse(await request("/api/v1/cook-sessions", {
    method: "POST",
    body: JSON.stringify({
      recipeId: assessment.recipe.id,
      assessment,
    }),
  }));
}

export async function reconcileCookSession(
  sessionId: string,
  changes: ReconciliationChange[],
): Promise<unknown> {
  return request(`/api/v1/cook-sessions/${encodeURIComponent(sessionId)}/reconcile`, {
    method: "POST",
    body: JSON.stringify({ changes }),
  });
}
