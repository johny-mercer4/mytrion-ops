import { MytrionScaffold } from '../_shared/MytrionScaffold';

/** Mytrion Admin — Octane team RnD: knowledge base, agent scope, RBAC. Ported from agent-scope. */
export default function AdminMytrion() {
  return (
    <MytrionScaffold
      id="admin"
      buildNotes={[
        'Knowledge base manager (upload/list/delete docs; per-department tagging) → POST /v1/knowledge/embed, /v1/knowledge/query, delete',
        'Agent Scope graph (Vue Flow stages → React Flow): AS_STAGES data + scope-color constants',
        'Scope risks CRUD (Blockers/Red Flags/Manual Processes) → /v1/scope endpoints (admin-only)',
        'Chat with allDepartments:true (broad retrieval) — already wired below',
      ]}
    />
  );
}
