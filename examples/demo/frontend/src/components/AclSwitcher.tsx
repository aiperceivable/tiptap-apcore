interface AclSwitcherProps {
  role: "readonly" | "editor" | "admin";
  onChange: (role: "readonly" | "editor" | "admin") => void;
}

const ROLE_DESCRIPTIONS: Record<string, string> = {
  readonly: "Only query modules allowed. No editing.",
  editor: "Query + format + content + history + selection.",
  admin: "Full access including destructive operations.",
};

export default function AclSwitcher({ role, onChange }: AclSwitcherProps) {
  const roles: Array<"readonly" | "editor" | "admin"> = [
    "readonly",
    "editor",
    "admin",
  ];

  return (
    <div className="card acl-switcher">
      <h2>ACL Role</h2>
      <div className="acl-options">
        {roles.map((r) => (
          <button
            key={r}
            className={`acl-option ${role === r ? "active" : ""}`}
            onClick={() => onChange(r)}
          >
            {r}
          </button>
        ))}
      </div>
      <div className="acl-description">{ROLE_DESCRIPTIONS[role]}</div>
    </div>
  );
}
