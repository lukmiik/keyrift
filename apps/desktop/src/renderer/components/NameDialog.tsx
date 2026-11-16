/**
 * A dialog that asks for a name (of a profile or a layer). Checks that one was entered, then hands
 * it to `onSubmit` and shows the error that comes back, if any.
 */
import { type FormEvent, useId, useState } from "react";

import { Button } from "./ui/button.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";
import { Input } from "./ui/input.tsx";
import { Label } from "./ui/label.tsx";

type NameDialogProps = {
  title: string;
  description: string;
  submitLabel: string;
  initialName: string;
  /** A line under the input that depends on the name, e.g. the file it becomes. */
  hint?: (name: string) => string;
  /** Does the change. Resolves to an error to show, or null when done (the dialog then closes). */
  onSubmit: (name: string) => Promise<string | null>;
  onClose: () => void;
};

export function NameDialog({
  title,
  description,
  submitLabel,
  initialName,
  hint,
  onSubmit,
  onClose,
}: NameDialogProps) {
  // A controlled input: React state holds the text, and the input shows the state.
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A unique id ties the label to the input (for screen readers and getByLabelText).
  const inputId = useId();

  async function submit(event: FormEvent): Promise<void> {
    // A form's submit would reload the page; we handle it ourselves.
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Enter a name");
      return;
    }
    setBusy(true);
    const failed = await onSubmit(trimmedName);
    setBusy(false);
    if (failed === null) {
      onClose();
    } else {
      setError(failed);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {/* A form, so Enter in the input submits. */}
        <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor={inputId}>Name</Label>
            <Input
              id={inputId}
              value={name}
              onChange={(event) => {
                setError(null);
                setName(event.target.value);
              }}
              aria-invalid={error !== null}
              autoFocus
            />
            {hint !== undefined && (
              <p className="text-sm text-muted-foreground">{hint(name.trim())}</p>
            )}
            {error !== null && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={busy}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
