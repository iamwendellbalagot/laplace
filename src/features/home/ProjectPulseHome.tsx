import type {
  ProjectSummary,
  RookSessionSummary,
  WorkspacePulse,
} from "../../services/contracts";
import type { PageId } from "../../state/app-store";

export function ProjectPulseHome({
  activeProject,
  recentProjects,
  workspacePulse,
  rookSessions,
  projectPending,
  browserPreview,
  onOpenProject,
  onNavigate,
  onResumeRookSession,
}: {
  activeProject?: ProjectSummary;
  recentProjects: ProjectSummary[];
  workspacePulse: WorkspacePulse | null;
  rookSessions: RookSessionSummary[];
  projectPending: boolean;
  browserPreview: boolean;
  onOpenProject: (path?: string) => void;
  onNavigate: (page: PageId) => void;
  onResumeRookSession: (id: string) => void;
}) {
  const dirtyTotal =
    (workspacePulse?.dirtyCount ?? 0) + (workspacePulse?.untrackedCount ?? 0);

  return (
    <section className="home-page" aria-labelledby="screen-title">
      <div className="home-copy">
        <p className="eyebrow">A focused desktop workspace</p>
        <h1 id="screen-title">
          Code when you want.
          <br />
          Delegate when you need.
        </h1>
        <p className="home-intro">
          Understand, change, and verify software in one local-first glass-box
          workflow.
        </p>

        <div className="home-open-state">
          <span
            className={`status-dot${activeProject ? "" : " status-dot-muted"}`}
          />
          <div>
            <strong>{activeProject?.name ?? "No project open"}</strong>
            <span>
              {activeProject
                ? workspacePulse?.isGitRepository
                  ? `${workspacePulse.branch ?? "Git repository"} · ${dirtyTotal > 0 ? `${dirtyTotal} modified` : "clean working tree"}${workspacePulse.latestExecutionStatus ? ` · verify: ${workspacePulse.latestExecutionStatus}` : ""}`
                  : activeProject.isGitRepository
                    ? "Git repository · local files only"
                    : "Folder open · not a Git repository"
                : "Opening a folder never runs project code."}
            </span>
          </div>
        </div>

        <p className="home-note">
          Laplace does not run package scripts, shells, or agent tools when a
          project is opened. Files remain available without trusting the
          project.
        </p>

        <div className="home-actions">
          <button
            className="button button-primary"
            type="button"
            disabled={projectPending || browserPreview}
            onClick={() => onOpenProject()}
          >
            {browserPreview
              ? "Open project · desktop app only"
              : projectPending
                ? "Opening…"
                : "Open project folder"}
            {!projectPending && !browserPreview && (
              <span aria-hidden="true">→</span>
            )}
          </button>
          <button
            className="button button-quiet"
            type="button"
            onClick={() => onNavigate("editor")}
          >
            {activeProject ? "Return to workspace" : "View workspace shell"}
          </button>
          {activeProject?.isGitRepository && (
            <button
              className="button button-quiet"
              type="button"
              onClick={() => onNavigate("changes")}
            >
              Review changes
            </button>
          )}
          <button
            className="button button-quiet"
            type="button"
            onClick={() => onNavigate("settings")}
          >
            Appearance settings
          </button>
        </div>

        {activeProject && rookSessions.length > 0 && (
          <section
            className="recent-projects"
            aria-label="Recent Rook sessions"
          >
            <p className="eyebrow">Recent Rook sessions</p>
            {rookSessions.slice(0, 4).map((session) => (
              <button
                className="recent-project-item"
                key={session.id}
                type="button"
                onClick={() => onResumeRookSession(session.id)}
              >
                <span className="project-avatar" aria-hidden="true">
                  ◉
                </span>
                <span>
                  <strong>
                    {(
                      session.name ||
                      session.firstMessage ||
                      "Untitled Ask"
                    ).trim()}
                  </strong>
                  <small>
                    {session.messageCount} messages ·{" "}
                    {new Date(session.modified).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </small>
                </span>
              </button>
            ))}
          </section>
        )}

        {recentProjects.length > 0 && (
          <section className="recent-projects" aria-label="Recent projects">
            <p className="eyebrow">Recent folders · no tools run</p>
            {recentProjects.map((project) => (
              <button
                className="recent-project-item"
                key={project.id}
                type="button"
                disabled={projectPending}
                onClick={() => onOpenProject(project.path)}
              >
                <span className="project-avatar" aria-hidden="true">
                  {project.name.slice(0, 1)}
                </span>
                <span>
                  <strong>{project.name}</strong>
                  <small>{project.path}</small>
                </span>
              </button>
            ))}
          </section>
        )}
      </div>

      <div className="home-orbit" aria-hidden="true">
        <span className="orbit-ring orbit-ring-outer" />
        <span className="orbit-ring orbit-ring-middle" />
        <span className="orbit-ring orbit-ring-inner" />
        <span className="orbit-axis orbit-axis-one" />
        <span className="orbit-axis orbit-axis-two" />
        <span className="orbit-glyph">ℒ</span>
        <span className="orbit-caption">LOCAL · EXPLICIT · REVIEWABLE</span>
      </div>
    </section>
  );
}
