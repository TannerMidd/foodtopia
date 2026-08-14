/**
 * Initial checked-in Supabase schema types.
 *
 * Regenerate this file with `supabase gen types typescript --local` (or against
 * the linked project) after every applied migration and review the diff. Keeping
 * this bootstrap type in source makes server repositories type-safe before the
 * first project link; the migration remains the database source of truth.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type HouseholdRole = "owner" | "member";
type InviteStatus = "pending" | "accepted" | "revoked" | "expired";
type QuantityStatus = "unknown" | "estimated" | "known";
type FoodLocation = "unknown" | "pantry" | "fridge" | "freezer" | "other";
type FoodForm = "unspecified" | "fresh" | "frozen" | "canned" | "dried" | "cooked" | "opened";
type DateLabelType = "best_before" | "sell_by" | "use_by" | "unknown";
type InventoryLotStatus = "active" | "consumed" | "discarded";
type InventoryCommandType = "add" | "adjust" | "consume" | "discard" | "restore";
type AnalysisStatus =
  | "created"
  | "uploaded"
  | "queued"
  | "processing"
  | "needs_review"
  | "applied"
  | "failed"
  | "cancelled"
  | "expired";
type ImageAssetStatus =
  | "pending_upload"
  | "uploaded"
  | "processing"
  | "processed"
  | "purge_pending"
  | "deleted"
  | "failed";
type CandidateStatus = "proposed" | "accepted" | "rejected";
type RecipeVisibility = "household" | "published";
type RecipeReviewStatus = "draft" | "reviewed";
type CookSessionStatus = "active" | "reconciled" | "cancelled";
type CookAction = "no_change" | "used_some" | "used_up";
type ProductEventSource = "client" | "server" | "worker";
type ProductEventName =
  | "analysis_created"
  | "analysis_completed"
  | "analysis_cancelled"
  | "analysis_failed"
  | "analysis_reviewed"
  | "analysis_applied"
  | "recipe_suggestions_requested"
  | "recipe_suggestions_returned"
  | "recipe_opened"
  | "invite_created"
  | "cook_started"
  | "cook_reconciled"
  | "inventory_command_applied"
  | "offline_sync_completed"
  | "purge_completed";
type RateLimitAction =
  | "analysis_create"
  | "recipe_suggest"
  | "invite_create"
  | "inventory_command"
  | "cook_reconcile";
type AiProvider = "openai" | "openrouter";
type AiCredentialSource = "platform" | "household";

type Table<Row extends Record<string, unknown>> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<{
        id: string;
        display_name: string | null;
        avatar_url: string | null;
        timezone: string;
        created_at: string;
        updated_at: string;
        version: number;
      }>;
      beta_invites: Table<{
        id: string;
        email: string;
        token_hash: string;
        expires_at: string;
        claimed_by: string | null;
        claimed_at: string | null;
        revoked_at: string | null;
        created_at: string;
        updated_at: string;
        version: number;
      }>;
      households: Table<{
        id: string;
        name: string;
        created_by: string;
        deletion_requested_at: string | null;
        deletion_requested_by: string | null;
        created_at: string;
        updated_at: string;
        version: number;
      }>;
      household_members: Table<{
        household_id: string;
        user_id: string;
        role: HouseholdRole;
        invited_by: string | null;
        created_at: string;
        updated_at: string;
        version: number;
      }>;
      privacy_consents: Table<{
        user_id: string;
        household_id: string;
        consent_version: string;
        consented_at: string;
      }>;
      api_rate_limits: Table<{
        household_id: string;
        user_id: string;
        action: RateLimitAction;
        window_seconds: number;
        window_started_at: string;
        request_count: number;
        created_at: string;
        updated_at: string;
        version: number;
      }>;
      household_invites: Table<{
        id: string;
        household_id: string;
        email: string;
        role: HouseholdRole;
        token_hash: string;
        status: InviteStatus;
        expires_at: string;
        created_by: string;
        accepted_by: string | null;
        accepted_at: string | null;
        revoked_at: string | null;
        created_at: string;
        updated_at: string;
        version: number;
      }>;
      food_concepts: Table<{
        id: string;
        canonical_name: string;
        category: string;
        default_unit: string | null;
        is_active: boolean;
        created_at: string;
        updated_at: string;
        version: number;
      }>;
      food_aliases: Table<{
        id: string;
        scope: "global" | "household";
        household_id: string | null;
        food_concept_id: string;
        alias: string;
        normalized_alias: string;
        created_by: string | null;
        created_at: string;
        updated_at: string;
        version: number;
      }>;
      household_custom_food_concepts: Table<{
        id: string;
        household_id: string;
        normalized_name: string;
        display_name: string;
        category: string;
        created_by: string;
        created_at: string;
        updated_at: string;
        version: number;
      }>;
      inventory_lots: Table<{
        id: string;
        household_id: string;
        food_concept_id: string | null;
        custom_food_concept_id: string | null;
        name: string;
        category: string;
        quantity_status: QuantityStatus;
        quantity: number | null;
        unit: string | null;
        form: FoodForm;
        location: FoodLocation;
        date_label_type: DateLabelType | null;
        date_label: string | null;
        status: InventoryLotStatus;
        metadata: Json;
        created_by: string;
        created_at: string;
        updated_at: string;
        version: number;
      }>;
      inventory_commands: Table<{
        id: string;
        household_id: string;
        idempotency_key: string;
        command_type: InventoryCommandType;
        target_lot_id: string;
        expected_version: number | null;
        payload: Json;
        status: "applied";
        result: Json;
        created_by: string;
        created_at: string;
        applied_at: string;
      }>;
      inventory_events: Table<{
        id: string;
        household_id: string;
        command_id: string;
        lot_id: string;
        event_type:
          | "lot_added"
          | "lot_adjusted"
          | "lot_consumed"
          | "lot_discarded"
          | "lot_restored"
          | "lot_added_from_analysis"
          | "lot_reconciled";
        prior_version: number | null;
        new_version: number;
        quantity_before: number | null;
        quantity_after: number | null;
        lot_snapshot: Json;
        created_by: string;
        created_at: string;
      }>;
      analyses: Table<{
        id: string;
        household_id: string;
        status: AnalysisStatus;
        image_count: number;
        idempotency_key: string | null;
        output_schema_version: string;
        provider: string | null;
        model: string | null;
        prompt_version: string | null;
        error_code: string | null;
        error_detail: string | null;
        application_fingerprint: string | null;
        created_by: string;
        created_at: string;
        updated_at: string;
        started_at: string | null;
        completed_at: string | null;
        purge_after: string;
        purge_claimed_at: string | null;
        purge_claimed_by: string | null;
        version: number;
      }>;
      image_assets: Table<{
        id: string;
        household_id: string;
        analysis_id: string;
        image_index: number;
        bucket_id: string;
        object_path: string;
        original_filename: string;
        content_type: string;
        byte_size: number;
        checksum_sha256: string | null;
        status: ImageAssetStatus;
        upload_authorization_expires_at: string;
        created_by: string;
        created_at: string;
        updated_at: string;
        version: number;
      }>;
      analysis_candidates: Table<{
        id: string;
        household_id: string;
        analysis_id: string;
        ordinal: number;
        raw_label: string;
        suggested_food_concept_id: string | null;
        suggested_name: string;
        category: string;
        quantity_status: QuantityStatus;
        quantity: number | null;
        unit: string | null;
        form: FoodForm;
        location: FoodLocation;
        date_label_type: DateLabelType | null;
        date_label: string | null;
        image_indexes: number[];
        confidence: number | null;
        uncertainty_reason: string | null;
        review_status: CandidateStatus;
        accepted: boolean;
        applied_lot_id: string | null;
        application_command_id: string | null;
        reviewed_by: string | null;
        reviewed_at: string | null;
        created_at: string;
        updated_at: string;
        version: number;
      }>;
      recipes: Table<{
        id: string;
        household_id: string | null;
        visibility: RecipeVisibility;
        slug: string;
        title: string;
        description: string;
        servings: number;
        total_minutes: number;
        meal_types: string[];
        cuisines: string[];
        dietary_tags: string[];
        steps: string[];
        rights_owner: string;
        rights_author: string;
        rights_reviewer: string | null;
        rights_reviewed_at: string | null;
        rights_status: RecipeReviewStatus;
        created_by: string | null;
        created_at: string;
        updated_at: string;
        version: number;
      }>;
      recipe_ingredients: Table<{
        id: string;
        recipe_id: string;
        household_id: string | null;
        position: number;
        food_concept_id: string;
        quantity: number | null;
        unit: string | null;
        optional: boolean;
        display: string;
        accepted_forms: FoodForm[];
        created_at: string;
        updated_at: string;
        version: number;
      }>;
      household_preferences: Table<{
        household_id: string;
        staples: string[];
        dietary_tags: string[];
        excluded_food_concept_ids: string[];
        updated_by: string;
        created_at: string;
        updated_at: string;
        version: number;
      }>;
      household_ai_settings: Table<{
        household_id: string;
        provider: AiProvider;
        vision_model_id: string;
        recipe_model_id: string;
        credential_source: AiCredentialSource;
        updated_by: string;
        created_at: string;
        updated_at: string;
        version: number;
      }>;
      cook_sessions: Table<{
        id: string;
        household_id: string;
        recipe_id: string | null;
        recipe_snapshot: Json;
        servings: number;
        status: CookSessionStatus;
        started_by: string;
        started_at: string;
        completed_at: string | null;
        reconciliation_fingerprint: string | null;
        created_at: string;
        updated_at: string;
        version: number;
      }>;
      cook_reconciliations: Table<{
        id: string;
        household_id: string;
        cook_session_id: string;
        ingredient_id: string;
        lot_id: string;
        action: CookAction;
        quantity: number | null;
        unit: string | null;
        expected_version: number;
        applied_command_id: string | null;
        created_by: string;
        created_at: string;
      }>;
      product_events: Table<{
        id: string;
        household_id: string;
        user_id: string;
        event_name: ProductEventName;
        source: ProductEventSource;
        properties: Json;
        client_session_id: string | null;
        idempotency_key: string | null;
        occurred_at: string;
        received_at: string;
      }>;
    };
    Views: Record<string, never>;
    Functions: {
      before_user_created: { Args: { event: Json }; Returns: Json };
      record_privacy_consent: { Args: { p_consent_version: string }; Returns: Json };
      consume_rate_limit: {
        Args: { p_action: string; p_limit: number; p_window_seconds: number };
        Returns: Json;
      };
      record_product_event: {
        Args: {
          p_event_name: string;
          p_properties?: Json;
          p_client_session_id?: string;
          p_idempotency_key?: string;
        };
        Returns: Json;
      };
      bootstrap_household: { Args: { p_name: string; p_beta_token: string }; Returns: string };
      create_household_invite: {
        Args: { p_email: string; p_token: string; p_expires_at?: string };
        Returns: string;
      };
      accept_household_invite: { Args: { p_token: string }; Returns: string };
      revoke_household_invite: { Args: { p_invite_id: string }; Returns: undefined };
      list_household_invites: {
        Args: Record<PropertyKey, never>;
        Returns: Array<{
          id: string;
          email: string;
          role: HouseholdRole;
          status: InviteStatus;
          expires_at: string;
          created_at: string;
          accepted_at: string | null;
          revoked_at: string | null;
        }>;
      };
      list_household_members: { Args: Record<PropertyKey, never>; Returns: Json };
      remove_household_member: { Args: { p_user_id: string }; Returns: Json };
      apply_inventory_command: {
        Args: {
          p_command_id: string;
          p_command_type: InventoryCommandType;
          p_expected_version: number | null;
          p_payload: Json;
        };
        Returns: Json;
      };
      apply_analysis_candidates: {
        Args: { p_analysis_id: string; p_expected_version: number; p_candidates: Json };
        Returns: Json;
      };
      create_analysis: {
        Args: { p_analysis_id: string; p_assets: Json; p_idempotency_key?: string | null };
        Returns: Json;
      };
      get_inventory_sync: {
        Args: {
          p_after_created_at?: string | null;
          p_after_event_id?: string | null;
          p_limit?: number;
        };
        Returns: Json;
      };
      complete_analysis: {
        Args: { p_analysis_id: string; p_asset_ids: string[] };
        Returns: Json;
      };
      cancel_analysis: { Args: { p_analysis_id: string }; Returns: Json };
      store_analysis_candidates: {
        Args: {
          p_analysis_id: string;
          p_from_status: AnalysisStatus;
          p_to_status: AnalysisStatus;
          p_candidates?: Json;
          p_provider?: string | null;
          p_model?: string | null;
          p_prompt_version?: string | null;
          p_error_code?: string | null;
          p_error_detail?: string | null;
        };
        Returns: Json;
      };
      apply_cook_reconciliation: {
        Args: { p_cook_session_id: string; p_changes: Json };
        Returns: Json;
      };
      claim_expired_image_assets: {
        Args: { p_worker_id: string; p_limit?: number };
        Returns: Array<{
          analysis_id: string;
          household_id: string;
          asset_id: string;
          object_path: string;
        }>;
      };
      complete_raw_image_purge: { Args: { p_asset_ids: string[] }; Returns: number };
      request_household_deletion: { Args: Record<PropertyKey, never>; Returns: Json };
      finalize_household_deletion: { Args: { p_household_id: string }; Returns: Json };
      get_household_ai_settings: { Args: Record<PropertyKey, never>; Returns: Json };
      write_household_ai_settings: {
        Args: {
          p_provider: AiProvider;
          p_vision_model_id: string;
          p_recipe_model_id: string;
          p_credential_source: AiCredentialSource;
          p_credential_action: "retain" | "replace" | "clear";
          p_encrypted_api_key: string | null;
          p_encryption_key_id: string | null;
          p_expected_version: number;
        };
        Returns: Json;
      };
      get_household_ai_runtime_config: { Args: { p_household_id: string }; Returns: Json };
      rotate_household_ai_credential: {
        Args: {
          p_household_id: string;
          p_expected_provider: AiProvider;
          p_expected_encryption_key_id: string;
          p_expected_encrypted_api_key: string;
          p_new_encryption_key_id: string;
          p_new_encrypted_api_key: string;
        };
        Returns: boolean;
      };
    };
    Enums: {
      household_role: HouseholdRole;
      invite_status: InviteStatus;
      food_alias_scope: "global" | "household";
      quantity_status: QuantityStatus;
      food_location: FoodLocation;
      food_form: FoodForm;
      date_label_type: DateLabelType;
      inventory_lot_status: InventoryLotStatus;
      inventory_command_type: InventoryCommandType;
      inventory_command_status: "applied";
      inventory_event_type:
        | "lot_added"
        | "lot_adjusted"
        | "lot_consumed"
        | "lot_discarded"
        | "lot_restored"
        | "lot_added_from_analysis"
        | "lot_reconciled";
      analysis_status: AnalysisStatus;
      image_asset_status: ImageAssetStatus;
      analysis_candidate_status: CandidateStatus;
      recipe_visibility: RecipeVisibility;
      recipe_review_status: RecipeReviewStatus;
      cook_session_status: CookSessionStatus;
      cook_reconciliation_action: CookAction;
      product_event_source: ProductEventSource;
      product_event_name: ProductEventName;
      api_rate_limit_action: RateLimitAction;
    };
    CompositeTypes: Record<string, never>;
  };
};
