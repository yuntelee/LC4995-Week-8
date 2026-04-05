"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Play, Save, Trash2 } from "lucide-react";
import { TABLES } from "@/lib/config";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";
import type {
  CaptionHistoryItem,
  ExecutionTrace,
  HumorFlavor,
  HumorFlavorStep,
  StepInputSource,
} from "@/types/humor";

type FlavorDraft = {
  name: string;
  description: string;
};

type StepDraft = {
  title: string;
  prompt_template: string;
  input_source: StepInputSource;
};

const EMPTY_FLAVOR_DRAFT: FlavorDraft = {
  name: "",
  description: "",
};

const EMPTY_STEP_DRAFT: StepDraft = {
  title: "",
  prompt_template: "",
  input_source: "previous_step",
};

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function normalizeTrace(value: unknown): ExecutionTrace[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const row = item as Record<string, unknown>;
      return {
        stepId: typeof row.stepId === "string" ? row.stepId : "",
        stepTitle: typeof row.stepTitle === "string" ? row.stepTitle : "",
        prompt: typeof row.prompt === "string" ? row.prompt : "",
        inputText: typeof row.inputText === "string" ? row.inputText : "",
        outputText: typeof row.outputText === "string" ? row.outputText : "",
        captions: normalizeStringArray(row.captions),
      };
    })
    .filter((item): item is ExecutionTrace => Boolean(item));
}

function normalizeHistoryRow(row: Record<string, unknown>): CaptionHistoryItem {
  return {
    id: String(row.id ?? ""),
    humor_flavor_id: String(row.humor_flavor_id ?? ""),
    image_url: String(row.image_url ?? ""),
    captions: normalizeStringArray(row.captions),
    trace: normalizeTrace(row.trace),
    created_at: String(row.created_at ?? ""),
  };
}

function withOrder(steps: HumorFlavorStep[]) {
  return steps.map((step, index) => ({
    ...step,
    order_index: index + 1,
  }));
}

export function HumorFlavorManager() {
  const supabase = useMemo(() => getBrowserSupabaseClient(), []);

  const [status, setStatus] = useState<string>("");
  const [loadingFlavors, setLoadingFlavors] = useState(false);
  const [flavors, setFlavors] = useState<HumorFlavor[]>([]);
  const [selectedFlavorId, setSelectedFlavorId] = useState<string | null>(null);

  const [newFlavor, setNewFlavor] = useState<FlavorDraft>(EMPTY_FLAVOR_DRAFT);
  const [editingFlavorId, setEditingFlavorId] = useState<string | null>(null);
  const [editingFlavorDraft, setEditingFlavorDraft] = useState<FlavorDraft>(EMPTY_FLAVOR_DRAFT);

  const [steps, setSteps] = useState<HumorFlavorStep[]>([]);
  const [newStep, setNewStep] = useState<StepDraft>(EMPTY_STEP_DRAFT);
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [editingStepDraft, setEditingStepDraft] = useState<StepDraft>(EMPTY_STEP_DRAFT);

  const [imageUrl, setImageUrl] = useState("");
  const [testing, setTesting] = useState(false);
  const [generatedCaptions, setGeneratedCaptions] = useState<string[]>([]);
  const [latestTrace, setLatestTrace] = useState<ExecutionTrace[]>([]);
  const [history, setHistory] = useState<CaptionHistoryItem[]>([]);

  const selectedFlavor = useMemo(
    () => flavors.find((flavor) => flavor.id === selectedFlavorId) ?? null,
    [flavors, selectedFlavorId],
  );

  const loadFlavors = useCallback(async () => {
    setLoadingFlavors(true);
    setStatus("");

    const { data, error } = await supabase
      .from(TABLES.flavors)
      .select("id,name,description,created_at,updated_at")
      .order("created_at", { ascending: false });

    setLoadingFlavors(false);

    if (error) {
      setStatus(`Failed to load humor flavors: ${error.message}`);
      return;
    }

    const rows = (data ?? []) as HumorFlavor[];
    setFlavors(rows);

    if (!selectedFlavorId && rows.length > 0) {
      setSelectedFlavorId(rows[0].id);
    }

    if (rows.length === 0) {
      setSelectedFlavorId(null);
    }
  }, [selectedFlavorId, supabase]);

  const loadSteps = useCallback(async (flavorId: string) => {
    const { data, error } = await supabase
      .from(TABLES.steps)
      .select("id,humor_flavor_id,order_index,title,prompt_template,input_source,created_at,updated_at")
      .eq("humor_flavor_id", flavorId)
      .order("order_index", { ascending: true });

    if (error) {
      setStatus(`Failed to load steps: ${error.message}`);
      return;
    }

    setSteps((data ?? []) as HumorFlavorStep[]);
  }, [supabase]);

  const loadHistory = useCallback(async (flavorId: string) => {
    const { data, error } = await supabase
      .from(TABLES.history)
      .select("id,humor_flavor_id,image_url,captions,trace,created_at")
      .eq("humor_flavor_id", flavorId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) {
      setStatus(`Failed to load history: ${error.message}`);
      return;
    }

    const nextHistory = (data ?? []).map((row) => normalizeHistoryRow(row as Record<string, unknown>));
    setHistory(nextHistory);
  }, [supabase]);

  useEffect(() => {
    void loadFlavors();
  }, [loadFlavors]);

  useEffect(() => {
    if (!selectedFlavorId) {
      setSteps([]);
      setHistory([]);
      setGeneratedCaptions([]);
      setLatestTrace([]);
      return;
    }

    void loadSteps(selectedFlavorId);
    void loadHistory(selectedFlavorId);
  }, [loadHistory, loadSteps, selectedFlavorId]);

  async function createFlavor(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!newFlavor.name.trim()) {
      setStatus("Flavor name is required.");
      return;
    }

    const { error } = await supabase.from(TABLES.flavors).insert({
      name: newFlavor.name.trim(),
      description: newFlavor.description.trim() || null,
    });

    if (error) {
      setStatus(`Create failed: ${error.message}`);
      return;
    }

    setNewFlavor(EMPTY_FLAVOR_DRAFT);
    setStatus("Humor flavor created.");
    await loadFlavors();
  }

  async function saveFlavor(flavorId: string) {
    const { error } = await supabase
      .from(TABLES.flavors)
      .update({
        name: editingFlavorDraft.name.trim(),
        description: editingFlavorDraft.description.trim() || null,
      })
      .eq("id", flavorId);

    if (error) {
      setStatus(`Update failed: ${error.message}`);
      return;
    }

    setEditingFlavorId(null);
    setStatus("Flavor updated.");
    await loadFlavors();
  }

  async function deleteFlavor(flavorId: string) {
    const confirmed = window.confirm("Delete this humor flavor and all related steps/history?");
    if (!confirmed) {
      return;
    }

    const { error } = await supabase.from(TABLES.flavors).delete().eq("id", flavorId);

    if (error) {
      setStatus(`Delete failed: ${error.message}`);
      return;
    }

    setStatus("Flavor deleted.");
    if (selectedFlavorId === flavorId) {
      setSelectedFlavorId(null);
    }
    await loadFlavors();
  }

  async function createStep(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!selectedFlavorId) {
      setStatus("Select a flavor first.");
      return;
    }

    if (!newStep.title.trim() || !newStep.prompt_template.trim()) {
      setStatus("Step title and prompt template are required.");
      return;
    }

    const { error } = await supabase.from(TABLES.steps).insert({
      humor_flavor_id: selectedFlavorId,
      order_index: steps.length + 1,
      title: newStep.title.trim(),
      prompt_template: newStep.prompt_template.trim(),
      input_source: newStep.input_source,
    });

    if (error) {
      setStatus(`Create step failed: ${error.message}`);
      return;
    }

    setNewStep(EMPTY_STEP_DRAFT);
    setStatus("Step created.");
    await loadSteps(selectedFlavorId);
  }

  async function saveStep(stepId: string) {
    const { error } = await supabase
      .from(TABLES.steps)
      .update({
        title: editingStepDraft.title.trim(),
        prompt_template: editingStepDraft.prompt_template.trim(),
        input_source: editingStepDraft.input_source,
      })
      .eq("id", stepId);

    if (error) {
      setStatus(`Update step failed: ${error.message}`);
      return;
    }

    setEditingStepId(null);
    setStatus("Step updated.");
    if (selectedFlavorId) {
      await loadSteps(selectedFlavorId);
    }
  }

  async function persistOrder(updatedSteps: HumorFlavorStep[]) {
    const updates = withOrder(updatedSteps);

    const results = await Promise.all(
      updates.map((step) =>
        supabase.from(TABLES.steps).update({ order_index: step.order_index }).eq("id", step.id),
      ),
    );

    const errored = results.find((result) => result.error);
    if (errored?.error) {
      setStatus(`Reorder failed: ${errored.error.message}`);
      return false;
    }

    setSteps(updates);
    return true;
  }

  async function moveStep(stepId: string, direction: "up" | "down") {
    const currentIndex = steps.findIndex((step) => step.id === stepId);
    if (currentIndex === -1) {
      return;
    }

    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= steps.length) {
      return;
    }

    const updated = [...steps];
    const [current] = updated.splice(currentIndex, 1);
    updated.splice(targetIndex, 0, current);

    const success = await persistOrder(updated);
    if (success) {
      setStatus("Step order updated.");
    }
  }

  async function deleteStep(stepId: string) {
    const confirmed = window.confirm("Delete this step?");
    if (!confirmed) {
      return;
    }

    const { error } = await supabase.from(TABLES.steps).delete().eq("id", stepId);
    if (error) {
      setStatus(`Delete step failed: ${error.message}`);
      return;
    }

    const remaining = steps.filter((step) => step.id !== stepId);
    const success = await persistOrder(remaining);
    if (success) {
      setStatus("Step deleted.");
    }
  }

  async function testFlavor() {
    if (!selectedFlavorId) {
      setStatus("Select a flavor first.");
      return;
    }

    if (!imageUrl.trim()) {
      setStatus("Image URL is required to run a test.");
      return;
    }

    setTesting(true);
    setStatus("");

    try {
      const response = await fetch("/api/test-humor-flavor", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          flavorId: selectedFlavorId,
          imageUrl: imageUrl.trim(),
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        captions?: string[];
        trace?: ExecutionTrace[];
      };

      if (!response.ok) {
        setStatus(payload.error ?? "Test failed.");
        return;
      }

      setGeneratedCaptions(payload.captions ?? []);
      setLatestTrace(payload.trace ?? []);
      setStatus("Test completed.");

      await loadHistory(selectedFlavorId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Test failed.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[350px_1fr]">
      <section className="app-card p-4 md:p-5">
        <h2 className="text-lg font-semibold">Humor flavors</h2>

        <form className="mt-4 space-y-2" onSubmit={createFlavor}>
          <input
            className="input"
            placeholder="Flavor name"
            value={newFlavor.name}
            onChange={(event) => setNewFlavor((prev) => ({ ...prev, name: event.target.value }))}
          />
          <textarea
            className="input"
            placeholder="Flavor description"
            value={newFlavor.description}
            onChange={(event) => setNewFlavor((prev) => ({ ...prev, description: event.target.value }))}
            rows={3}
          />
          <button className="btn btn-primary w-full" type="submit">
            Create flavor
          </button>
        </form>

        <div className="mt-5 space-y-2">
          {loadingFlavors ? <p className="subtle text-sm">Loading flavors...</p> : null}
          {flavors.map((flavor) => {
            const isSelected = flavor.id === selectedFlavorId;
            const isEditing = flavor.id === editingFlavorId;

            return (
              <div key={flavor.id} className="app-card p-3">
                {isEditing ? (
                  <div className="space-y-2">
                    <input
                      className="input"
                      value={editingFlavorDraft.name}
                      onChange={(event) =>
                        setEditingFlavorDraft((prev) => ({ ...prev, name: event.target.value }))
                      }
                    />
                    <textarea
                      className="input"
                      value={editingFlavorDraft.description}
                      onChange={(event) =>
                        setEditingFlavorDraft((prev) => ({ ...prev, description: event.target.value }))
                      }
                      rows={3}
                    />
                    <div className="flex gap-2">
                      <button className="btn btn-primary" type="button" onClick={() => void saveFlavor(flavor.id)}>
                        <Save className="mr-1 inline-block h-4 w-4" />
                        Save
                      </button>
                      <button className="btn" type="button" onClick={() => setEditingFlavorId(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      className={`w-full rounded-md border px-2 py-2 text-left ${
                        isSelected ? "border-teal-500" : "border-transparent"
                      }`}
                      onClick={() => setSelectedFlavorId(flavor.id)}
                      type="button"
                    >
                      <p className="font-medium">{flavor.name}</p>
                      <p className="subtle text-sm">{flavor.description || "No description"}</p>
                    </button>
                    <div className="mt-2 flex gap-2">
                      <button
                        className="btn"
                        type="button"
                        onClick={() => {
                          setEditingFlavorId(flavor.id);
                          setEditingFlavorDraft({
                            name: flavor.name,
                            description: flavor.description ?? "",
                          });
                        }}
                      >
                        Edit
                      </button>
                      <button className="btn btn-danger" type="button" onClick={() => void deleteFlavor(flavor.id)}>
                        <Trash2 className="mr-1 inline-block h-4 w-4" />
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}

          {!loadingFlavors && flavors.length === 0 ? <p className="subtle text-sm">No flavors yet.</p> : null}
        </div>
      </section>

      <section className="space-y-4">
        <article className="app-card p-4 md:p-5">
          <h2 className="text-lg font-semibold">Steps</h2>
          <p className="subtle mt-1 text-sm">
            {selectedFlavor ? `Managing steps for ${selectedFlavor.name}` : "Select a flavor to manage its steps."}
          </p>

          <form className="mt-4 grid gap-2 md:grid-cols-2" onSubmit={createStep}>
            <input
              className="input"
              placeholder="Step title"
              value={newStep.title}
              onChange={(event) => setNewStep((prev) => ({ ...prev, title: event.target.value }))}
              disabled={!selectedFlavor}
            />
            <select
              className="input"
              value={newStep.input_source}
              onChange={(event) =>
                setNewStep((prev) => ({
                  ...prev,
                  input_source: event.target.value as StepInputSource,
                }))
              }
              disabled={!selectedFlavor}
            >
              <option value="image">input image</option>
              <option value="previous_step">previous step output</option>
            </select>
            <textarea
              className="input md:col-span-2"
              placeholder="Prompt template"
              value={newStep.prompt_template}
              onChange={(event) =>
                setNewStep((prev) => ({ ...prev, prompt_template: event.target.value }))
              }
              rows={3}
              disabled={!selectedFlavor}
            />
            <button className="btn btn-primary md:col-span-2" type="submit" disabled={!selectedFlavor}>
              Add step
            </button>
          </form>

          <div className="mt-5 space-y-3">
            {steps.map((step, index) => {
              const isEditing = editingStepId === step.id;

              return (
                <div key={step.id} className="app-card p-3">
                  {isEditing ? (
                    <div className="space-y-2">
                      <input
                        className="input"
                        value={editingStepDraft.title}
                        onChange={(event) =>
                          setEditingStepDraft((prev) => ({ ...prev, title: event.target.value }))
                        }
                      />
                      <select
                        className="input"
                        value={editingStepDraft.input_source}
                        onChange={(event) =>
                          setEditingStepDraft((prev) => ({
                            ...prev,
                            input_source: event.target.value as StepInputSource,
                          }))
                        }
                      >
                        <option value="image">input image</option>
                        <option value="previous_step">previous step output</option>
                      </select>
                      <textarea
                        className="input"
                        value={editingStepDraft.prompt_template}
                        onChange={(event) =>
                          setEditingStepDraft((prev) => ({ ...prev, prompt_template: event.target.value }))
                        }
                        rows={3}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button className="btn btn-primary" type="button" onClick={() => void saveStep(step.id)}>
                          <Save className="mr-1 inline-block h-4 w-4" />
                          Save
                        </button>
                        <button className="btn" type="button" onClick={() => setEditingStepId(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-sm font-semibold uppercase tracking-wide text-teal-600">Step {index + 1}</p>
                          <p className="font-medium">{step.title}</p>
                          <p className="subtle text-sm">Source: {step.input_source}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="btn"
                            type="button"
                            onClick={() => void moveStep(step.id, "up")}
                            disabled={index === 0}
                          >
                            <ArrowUp className="h-4 w-4" />
                          </button>
                          <button
                            className="btn"
                            type="button"
                            onClick={() => void moveStep(step.id, "down")}
                            disabled={index === steps.length - 1}
                          >
                            <ArrowDown className="h-4 w-4" />
                          </button>
                          <button
                            className="btn"
                            type="button"
                            onClick={() => {
                              setEditingStepId(step.id);
                              setEditingStepDraft({
                                title: step.title,
                                prompt_template: step.prompt_template,
                                input_source: step.input_source,
                              });
                            }}
                          >
                            Edit
                          </button>
                          <button className="btn btn-danger" type="button" onClick={() => void deleteStep(step.id)}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      <pre className="mt-2 overflow-auto whitespace-pre-wrap text-sm">{step.prompt_template}</pre>
                    </>
                  )}
                </div>
              );
            })}

            {selectedFlavor && steps.length === 0 ? <p className="subtle text-sm">No steps yet.</p> : null}
          </div>
        </article>

        <article className="app-card p-4 md:p-5">
          <h2 className="text-lg font-semibold">Test humor flavor</h2>
          <p className="subtle mt-1 text-sm">Run all steps in order against a test image URL.</p>

          <div className="mt-4 flex flex-col gap-2 md:flex-row">
            <input
              className="input"
              placeholder="https://example.com/test-image.jpg"
              value={imageUrl}
              onChange={(event) => setImageUrl(event.target.value)}
              disabled={!selectedFlavor}
            />
            <button
              className="btn btn-primary md:w-48"
              onClick={() => void testFlavor()}
              type="button"
              disabled={!selectedFlavor || testing}
            >
              <Play className="mr-1 inline-block h-4 w-4" />
              {testing ? "Testing..." : "Test flavor"}
            </button>
          </div>

          {generatedCaptions.length > 0 ? (
            <div className="mt-4 app-card p-3">
              <p className="text-sm font-semibold uppercase tracking-wide text-teal-600">Generated captions</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                {generatedCaptions.map((caption, index) => (
                  <li key={`${caption}-${index}`} className="text-sm">
                    {caption}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {latestTrace.length > 0 ? (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium">Execution trace</summary>
              <div className="mt-2 space-y-2">
                {latestTrace.map((trace, index) => (
                  <div key={`${trace.stepId}-${index}`} className="app-card p-3">
                    <p className="font-medium">Step {index + 1}: {trace.stepTitle}</p>
                    <p className="subtle mt-1 text-xs">Input text: {trace.inputText || "(empty)"}</p>
                    <p className="subtle mt-1 text-xs">Output text: {trace.outputText || "(empty)"}</p>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </article>

        <article className="app-card p-4 md:p-5">
          <h2 className="text-lg font-semibold">Caption history</h2>
          <p className="subtle mt-1 text-sm">Most recent test runs for this flavor.</p>

          <div className="mt-4 space-y-2">
            {history.map((item) => (
              <div key={item.id} className="app-card p-3">
                <p className="subtle text-xs">{new Date(item.created_at).toLocaleString()}</p>
                <p className="subtle mt-1 text-xs">Image: {item.image_url}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {item.captions.map((caption, index) => (
                    <li key={`${item.id}-${index}`}>{caption}</li>
                  ))}
                </ul>
              </div>
            ))}

            {selectedFlavor && history.length === 0 ? <p className="subtle text-sm">No history yet.</p> : null}
          </div>
        </article>

        {status ? (
          <div className="app-card p-3">
            <p className="text-sm">{status}</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
