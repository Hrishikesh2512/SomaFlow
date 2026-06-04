import type { LanguageModel } from "ai";

let _model: LanguageModel | null = null;

export function setActiveModel(model: LanguageModel): void {
  _model = model;
}

export function getActiveModel(): LanguageModel {
  if (!_model) {
    throw new Error(
      "[SomaFlow] No AI model selected. resolveModel() must be called before use."
    );
  }
  return _model;
}
