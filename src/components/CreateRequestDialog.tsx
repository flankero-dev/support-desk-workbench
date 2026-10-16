import { useEffect, useRef, useState } from "react";
import { emptyRequest, validateRequest } from "../domain/createRequest.ts";
import type { DraftErrors, RequestDraft } from "../domain/createRequest.ts";
import { priorities } from "../domain/tickets.ts";
import type { Ticket } from "../domain/tickets.ts";

type Created = { ticket: Ticket; matches: boolean };
export function CreateRequestDialog({
  assignees,
  categories,
  onCreate,
  onClose,
}: {
  assignees: string[];
  categories: string[];
  onCreate: (draft: RequestDraft) => Created;
  onClose: (openId?: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const viewAfterClose = useRef<string | undefined>(undefined);
  const committed = useRef(false);
  const [draft, setDraft] = useState<RequestDraft>({ ...emptyRequest });
  const [errors, setErrors] = useState<DraftErrors>({});
  const [failure, setFailure] = useState("");
  const [created, setCreated] = useState<Created | null>(null);
  useEffect(() => {
    ref.current?.showModal();
    ref.current?.querySelector<HTMLInputElement>("#create-title")?.focus();
  }, []);
  useEffect(() => {
    if (created) resultRef.current?.focus();
  }, [created]);
  useEffect(() => {
    if (failure) errorRef.current?.focus();
  }, [failure]);
  function change<K extends keyof RequestDraft>(
    field: K,
    value: RequestDraft[K],
  ) {
    const next = { ...draft, [field]: value };
    setDraft(next);
    if (errors[field])
      setErrors((current) => ({
        ...current,
        [field]: validateRequest(next)[field],
      }));
    setFailure("");
  }
  const fieldClass =
    "tw:w-full tw:min-h-[44px] tw:aria-invalid:border-[#9b4335]";
  function field(field: keyof RequestDraft) {
    return {
      id: `create-${field}`,
      name: field,
      "aria-labelledby": `create-${field}-label`,
      "aria-invalid": Boolean(errors[field]),
      "aria-describedby": errors[field] ? `create-${field}-error` : undefined,
    };
  }
  function error(field: keyof RequestDraft) {
    return errors[field] ? (
      <span
        id={`create-${field}-error`}
        className="tw:text-[13px] tw:text-[#9b4335]"
      >
        {errors[field]}
      </span>
    ) : null;
  }
  return (
    <dialog
      ref={ref}
      className="create-request tw:max-w-[600px] tw:overscroll-contain"
      aria-labelledby={created ? "created-heading" : "create-heading"}
      aria-describedby={created ? "created-description" : "create-intro"}
      onClose={() => onClose(viewAfterClose.current)}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)",
          ) ?? [],
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        const active = document.activeElement;
        if (
          !controls.includes(active as HTMLElement) ||
          (event.shiftKey && active === first) ||
          (!event.shiftKey && active === last)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      }}
    >
      <div className="tw:p-[20px] tw:sm:p-[24px] tw:[overflow-wrap:anywhere]">
        {created ? (
          <div className="tw:flex tw:flex-col tw:gap-[16px]">
            <h2
              id="created-heading"
              ref={resultRef}
              tabIndex={-1}
              className="tw:text-[16px] tw:leading-[1.5]"
            >
              Request created
            </h2>
            <p id="created-description">
              Saved in this browser. New requests start as Open.
            </p>
            <div className="tw:rounded-md tw:border tw:border-solid tw:border-[#dce3db] tw:bg-[#f5f7f5] tw:p-[16px]">
              <h3 className="tw:m-0 tw:text-[23px] tw:font-semibold tw:leading-[1.3] tw:tracking-[-0.4px]">
                {created.ticket.title}
              </h3>
              <p className="tw:mt-[4px] tw:text-[13px] tw:text-[#58695e]">
                {created.ticket.customer} · {created.ticket.priority}
              </p>
              <p className="tw:mt-[12px] tw:text-[12px] tw:text-[#58695e]">
                Request ID: <span className="mono">{created.ticket.id}</span>
              </p>
            </div>
            <p>
              {created.matches
                ? "Your queue is on the page containing this request, with the current sort order."
                : "This request is hidden by your current search or filters. View it directly or change the filters in the queue."}
            </p>
            <div className="tw:flex tw:flex-col-reverse tw:gap-[12px] tw:sm:flex-row tw:sm:justify-end">
              <button
                className="tw:min-h-[44px]"
                onClick={() => ref.current?.close()}
              >
                Back to queue
              </button>
              <button
                className="primary tw:min-h-[44px]"
                onClick={() => {
                  viewAfterClose.current = created.ticket.id;
                  ref.current?.close();
                }}
              >
                View request
              </button>
            </div>
          </div>
        ) : (
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (committed.current) return;
              const invalid = validateRequest(draft);
              setErrors(invalid);
              setFailure("");
              const first = Object.keys(invalid)[0];
              if (first) {
                ref.current
                  ?.querySelector<HTMLElement>(`#create-${first}`)
                  ?.focus();
                return;
              }
              try {
                const result = onCreate(draft);
                committed.current = true;
                setCreated(result);
              } catch (cause) {
                setFailure(
                  cause instanceof Error
                    ? cause.message
                    : "The request could not be created. Your form is unchanged.",
                );
              }
            }}
          >
            <header className="tw:mb-[20px] tw:flex tw:items-start tw:justify-between tw:gap-[16px]">
              <div>
                <h2
                  id="create-heading"
                  className="tw:text-[23px] tw:leading-[1.3] tw:tracking-[-0.4px]"
                >
                  New request
                </h2>
                <p id="create-intro" className="tw:mt-[8px] tw:text-[#58695e]">
                  Add a request to this browser’s workspace. Fields marked * are
                  required.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close new request"
                className="tw:min-h-[44px] tw:shrink-0"
                onClick={() => ref.current?.close()}
              >
                Close <span aria-hidden="true">×</span>
              </button>
            </header>
            <div className="tw:grid tw:grid-cols-1 tw:gap-[16px] tw:sm:grid-cols-2">
              <label className="tw:sm:col-span-2" htmlFor="create-title">
                <span id="create-title-label">Title *</span>
                <input
                  {...field("title")}
                  autoFocus
                  required
                  maxLength={200}
                  className={fieldClass}
                  value={draft.title}
                  onChange={(e) => change("title", e.target.value)}
                />
                {error("title")}
              </label>
              <label htmlFor="create-customer">
                <span id="create-customer-label">Customer *</span>
                <input
                  {...field("customer")}
                  required
                  maxLength={200}
                  className={fieldClass}
                  value={draft.customer}
                  onChange={(e) => change("customer", e.target.value)}
                />
                {error("customer")}
              </label>
              <label htmlFor="create-category">
                <span id="create-category-label">Category *</span>
                <input
                  {...field("category")}
                  list="create-categories"
                  required
                  maxLength={200}
                  className={fieldClass}
                  value={draft.category}
                  onChange={(e) => change("category", e.target.value)}
                />
                <datalist id="create-categories">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
                {error("category")}
              </label>
              <label htmlFor="create-priority">
                <span id="create-priority-label">Priority</span>
                <select
                  {...field("priority")}
                  className={fieldClass}
                  value={draft.priority}
                  onChange={(e) =>
                    change("priority", e.target.value as Ticket["priority"])
                  }
                >
                  {priorities.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
                {error("priority")}
              </label>
              <label htmlFor="create-assignee">
                <span id="create-assignee-label">Assignee</span>
                <select
                  {...field("assignee")}
                  className={fieldClass}
                  value={draft.assignee}
                  onChange={(e) => change("assignee", e.target.value)}
                >
                  {assignees.map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
                {error("assignee")}
              </label>
              <label className="tw:sm:col-span-2" htmlFor="create-description">
                <span id="create-description-label">Description *</span>
                <textarea
                  {...field("description")}
                  required
                  maxLength={4000}
                  rows={4}
                  className={`${fieldClass} tw:min-h-[112px]`}
                  value={draft.description}
                  onChange={(e) => change("description", e.target.value)}
                />
                {error("description")}
                <span className="tw:text-[12px] tw:text-[#58695e]">
                  {draft.description.length}/4000 characters
                </span>
              </label>
            </div>
            {failure && (
              <p
                ref={errorRef}
                tabIndex={-1}
                role="alert"
                className="tw:mt-[16px] tw:rounded-md tw:border tw:border-solid tw:border-[#9b4335] tw:p-[12px] tw:text-[#9b4335]"
              >
                {failure}
              </p>
            )}
            <footer className="tw:mt-[24px] tw:flex tw:flex-col-reverse tw:gap-[12px] tw:border-0 tw:border-t tw:border-solid tw:border-[#e5ebe4] tw:pt-[16px] tw:sm:flex-row tw:sm:items-center tw:sm:justify-between">
              <p className="tw:text-[13px] tw:text-[#58695e]">
                Status: Open · Browser only
              </p>
              <div className="tw:flex tw:gap-[12px]">
                <button
                  type="button"
                  className="tw:min-h-[44px] tw:flex-1"
                  onClick={() => ref.current?.close()}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary tw:min-h-[44px] tw:flex-1 tw:whitespace-nowrap"
                >
                  Create request
                </button>
              </div>
            </footer>
          </form>
        )}
      </div>
    </dialog>
  );
}
