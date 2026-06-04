import { getActiveModel } from "./context";

/**
 * Returns the model the user selected at startup via resolveModel().
 * All orchestrators call this — no changes needed there.
 */
export function getAgentModel() {
  return getActiveModel();
}