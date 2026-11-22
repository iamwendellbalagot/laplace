import { useEffect, useState } from "react";
import type { AppService } from "./services/app-service";
import { AppServiceError } from "./services/app-service";
import type { AppEvent, PingResponse } from "./services/contracts";

interface AppProps {
  service: AppService;
}

export function App({ service }: AppProps) {
  const [response, setResponse] = useState<PingResponse>();
  const [event, setEvent] = useState<AppEvent>();
  const [error, setError] = useState<AppServiceError>();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;
    void service
      .listen((nextEvent) => {
        if (mounted) setEvent(nextEvent);
      })
      .then((stop) => {
        if (mounted) unlisten = stop;
        else stop();
      })
      .catch((listenError: unknown) => {
        if (mounted) {
          setError(
            listenError instanceof AppServiceError
              ? listenError
              : new AppServiceError(
                  "event_listener_unavailable",
                  "Native events could not be connected.",
                  "",
                  true,
                ),
          );
        }
      });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [service]);

  async function testNativeConnection() {
    setPending(true);
    setError(undefined);
    try {
      setResponse(await service.ping());
    } catch (pingError) {
      setResponse(undefined);
      setError(
        pingError instanceof AppServiceError
          ? pingError
          : new AppServiceError(
              "native_unavailable",
              "The native command failed. Check the application diagnostics and retry.",
              "",
              true,
            ),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="bootstrap">
      <p className="eyebrow">Desktop foundation</p>
      <h1>Laplace</h1>
      <p className="intro">
        Native commands do not run until you explicitly request them.
      </p>
      <button type="button" onClick={testNativeConnection} disabled={pending}>
        {pending ? "Checking…" : "Test native connection"}
      </button>
      <p aria-live="polite" role="status">
        {response?.message ?? "Native connection not tested."}
      </p>
      {event && (
        <p aria-live="polite" data-testid="native-event">
          Event {event.kind} · operation {event.operationId}
        </p>
      )}
      {error && (
        <p role="alert">
          {error.message} <span>({error.code})</span>
        </p>
      )}
    </main>
  );
}
