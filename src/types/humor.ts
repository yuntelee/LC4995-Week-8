export type ThemeMode = "light" | "dark" | "system";

export type Profile = {
  id: string;
  is_superadmin: boolean;
  is_matrix_admin: boolean;
};

export type HumorFlavor = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type StepInputSource = "image" | "previous_step";

export type HumorFlavorStep = {
  id: string;
  humor_flavor_id: string;
  order_index: number;
  title: string;
  prompt_template: string;
  input_source: StepInputSource;
  created_at?: string;
  updated_at?: string;
};

export type CaptionHistoryItem = {
  id: string;
  humor_flavor_id: string;
  image_url: string;
  captions: string[];
  trace: ExecutionTrace[];
  created_at: string;
};

export type ExecutionTrace = {
  stepId: string;
  stepTitle: string;
  prompt: string;
  inputText: string;
  outputText: string;
  captions: string[];
};
