import { createContext, useContext, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminMe } from "@happynails/shared";
import { Field, Message } from "./components/ui";
import { ApiError, api, errorText } from "./lib/api";

const MeContext = createContext<AdminMe | null>(null);

export function useMe(): AdminMe {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe outside a signed-in area");
  return me;
}
export const useIsOwner = () => useMe().role === "owner";

function Login() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = useMutation({
    mutationFn: () => api.post<AdminMe>("/auth/login", { email, password }),
    onSuccess: (me) => qc.setQueryData(["me"], me),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    login.mutate();
  }

  return (
    <div className="login">
      <form className="panel stack" onSubmit={submit}>
        <div className="brand">
          <span className="mono">HN</span>
          <span className="bn">
            Happy Nails<small>admin</small>
          </span>
        </div>
        <Field label="Email">
          {(id) => (
            <input
              id={id}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          )}
        </Field>
        <Field label="Password">
          {(id) => (
            <input
              id={id}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          )}
        </Field>
        <Message>{login.isError ? errorText(login.error) : null}</Message>
        <button className="btn" type="submit" disabled={login.isPending}>
          {login.isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

/** Shows the sign-in form until there is a session; any 401 later brings it back. */
export function AuthGate({ children }: { children: ReactNode }) {
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api.get<AdminMe>("/auth/me");
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: Infinity,
    retry: false,
  });
  if (me.isPending) return <p className="login note">Loading</p>;
  if (me.isError) return <p className="login msg no">The admin API could not be reached.</p>;
  if (!me.data) return <Login />;
  return <MeContext.Provider value={me.data}>{children}</MeContext.Provider>;
}
