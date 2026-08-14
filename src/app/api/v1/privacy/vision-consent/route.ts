import {
  readVisionConsent,
  saveVisionConsent,
} from "@/server/services/vision-consent";

export const dynamic = "force-dynamic";

export const GET = readVisionConsent;
export const POST = saveVisionConsent;
