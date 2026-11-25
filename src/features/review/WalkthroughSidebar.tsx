import type {
  WalkthroughStep,
  WorkspaceWalkthrough,
} from "../../services/contracts";
import {
  filterWalkthroughSteps,
  stepDisplayTitle,
  type WalkthroughFilter,
} from "./walkthrough-helpers";

export function WalkthroughSidebar({
  walkthrough,
  activeStepId,
  reviewedIds,
  filter,
  onFilterChange,
  onSelectStep,
  onToggleReviewed,
  onNarrateInRook,
}: {
  walkthrough: WorkspaceWalkthrough;
  activeStepId: string | undefined;
  reviewedIds: ReadonlySet<string>;
  filter: WalkthroughFilter;
  onFilterChange: (next: WalkthroughFilter) => void;
  onSelectStep: (step: WalkthroughStep) => void;
  onToggleReviewed: (stepId: string) => void;
  onNarrateInRook?: () => void;
}) {
  const reviewedCount = walkthrough.steps.filter((s) =>
    reviewedIds.has(s.id),
  ).length;
  const totalCount = walkthrough.steps.length;
  const progressPct =
    totalCount > 0 ? Math.round((reviewedCount / totalCount) * 100) : 0;

  const visibleSteps = filterWalkthroughSteps(
    walkthrough.steps,
    reviewedIds,
    filter,
  );
  const visibleIds = new Set(visibleSteps.map((s) => s.id));
  const stepById = new Map(walkthrough.steps.map((s) => [s.id, s]));

  return (
    <div
      className="walkthrough-sidebar"
      aria-label="Semantic change walkthrough"
    >
      <div className="walkthrough-progress-card">
        <div className="walkthrough-progress-head">
          <span>
            <strong>
              {reviewedCount} / {totalCount}
            </strong>{" "}
            reviewed
          </span>
          {walkthrough.highRiskCount > 0 && (
            <span className="walkthrough-risk-pill is-high">
              {walkthrough.highRiskCount} high risk
            </span>
          )}
        </div>
        <div
          className="walkthrough-progress-track"
          role="progressbar"
          aria-valuenow={reviewedCount}
          aria-valuemin={0}
          aria-valuemax={totalCount}
          aria-label="Walkthrough review progress"
        >
          <div
            className="walkthrough-progress-fill"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div
          className="walkthrough-filter-row"
          role="group"
          aria-label="Filter walkthrough steps"
        >
          <button
            type="button"
            className={`walkthrough-filter-btn${filter === "all" ? " is-active" : ""}`}
            onClick={() => onFilterChange("all")}
          >
            All ({totalCount})
          </button>
          <button
            type="button"
            className={`walkthrough-filter-btn${filter === "unreviewed" ? " is-active" : ""}`}
            onClick={() => onFilterChange("unreviewed")}
          >
            Left ({Math.max(0, totalCount - reviewedCount)})
          </button>
          {walkthrough.highRiskCount > 0 && (
            <button
              type="button"
              className={`walkthrough-filter-btn${filter === "high_risk" ? " is-active" : ""}`}
              onClick={() => onFilterChange("high_risk")}
            >
              Risk ({walkthrough.highRiskCount})
            </button>
          )}
        </div>
        {onNarrateInRook && (
          <button
            type="button"
            className="button button-quiet walkthrough-narrate-btn"
            onClick={onNarrateInRook}
          >
            Narrate walkthrough in Rook ↗
          </button>
        )}
      </div>

      <div
        className="walkthrough-chapter-list"
        role="list"
        aria-label="Walkthrough chapters"
      >
        {visibleSteps.length === 0 ? (
          <p className="walkthrough-empty-filter">
            {filter === "unreviewed"
              ? "All walkthrough steps reviewed."
              : "No steps match this filter."}
          </p>
        ) : (
          walkthrough.chapters.map((chapter, chapterIdx) => {
            const chapterSteps = chapter.stepIds
              .filter((id) => visibleIds.has(id))
              .map((id) => stepById.get(id))
              .filter((step): step is WalkthroughStep => Boolean(step));
            if (chapterSteps.length === 0) return null;

            return (
              <div className="walkthrough-chapter" key={chapter.id}>
                <div className="walkthrough-chapter-head">
                  <span className="review-role-heading">
                    {chapterIdx + 1}. {chapter.title} ({chapterSteps.length})
                  </span>
                </div>
                {chapterSteps.map((step) => {
                  const isActive = step.id === activeStepId;
                  const isReviewed = reviewedIds.has(step.id);
                  const baseName =
                    step.filePath.split("/").at(-1) ?? step.filePath;
                  const lineLabel =
                    step.hunkIndex !== null
                      ? `${baseName}:${Math.max(1, step.newStart)}`
                      : baseName;

                  return (
                    <div
                      key={step.id}
                      role="listitem"
                      className={`walkthrough-step-card${isActive ? " is-active" : ""}${isReviewed ? " is-reviewed" : ""}`}
                    >
                      <button
                        type="button"
                        className={`walkthrough-check-btn${isReviewed ? " is-reviewed" : ""}`}
                        aria-label={
                          isReviewed
                            ? `Mark step ${step.order} unreviewed`
                            : `Mark step ${step.order} reviewed`
                        }
                        title={isReviewed ? "Mark unreviewed" : "Mark reviewed"}
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleReviewed(step.id);
                        }}
                      >
                        {isReviewed ? "✓" : step.order}
                      </button>
                      <button
                        type="button"
                        className="walkthrough-step-select"
                        onClick={() => onSelectStep(step)}
                      >
                        <span className="walkthrough-step-title-row">
                          <strong className="walkthrough-step-title">
                            {stepDisplayTitle(step)}
                          </strong>
                          <span
                            className={`walkthrough-risk-dot is-${step.riskLevel}`}
                            title={
                              step.riskReasons.length > 0
                                ? step.riskReasons.join(" · ")
                                : `${step.riskLevel} risk`
                            }
                          />
                        </span>
                        <span className="walkthrough-step-meta">
                          <small>{lineLabel}</small>
                          {(step.addedLines > 0 || step.removedLines > 0) && (
                            <span className="walkthrough-step-delta">
                              +{step.addedLines}/-{step.removedLines}
                            </span>
                          )}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
