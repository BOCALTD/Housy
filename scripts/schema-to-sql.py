"""Generate the initial migration SQL from prisma/schema.prisma.

Used once to bootstrap the first migration in an environment without the Prisma
engines. CI runs `prisma migrate diff` to confirm the SQL matches the schema exactly.
Usage: python3 scripts/schema-to-sql.py prisma/schema.prisma > migration.sql
"""
import re
import sys

src = open(sys.argv[1], encoding="utf-8").read()
src = re.sub(r"//.*", "", src)

enums = {m.group(1): re.findall(r"^\s*([A-Z_]+)\s*$", m.group(2), re.M)
         for m in re.finditer(r"enum (\w+) \{([^}]*)\}", src)}
models = {m.group(1): m.group(2) for m in re.finditer(r"model (\w+) \{(.*?)\n\}", src, re.S)}

SCALAR = {"String": "TEXT", "Boolean": "BOOLEAN", "Int": "INTEGER", "BigInt": "BIGINT",
          "DateTime": "TIMESTAMP(3)", "Json": "JSONB"}
ONDELETE = {"Restrict": "RESTRICT", "Cascade": "CASCADE", "SetNull": "SET NULL", "NoAction": "NO ACTION"}

out = []
for name, values in enums.items():
    out.append(f'-- CreateEnum\nCREATE TYPE "{name}" AS ENUM ({", ".join(repr(v).replace(chr(34), chr(39)) for v in values)});\n')

indexes, fks = [], []
for model, body in models.items():
    table = re.search(r'@@map\("(\w+)"\)', body).group(1)
    colmap = {}
    cols, pk = [], None
    lines = [l.strip() for l in body.strip().split("\n") if l.strip() and not l.strip().startswith("@@")]
    for line in lines:
        parts = line.split()
        fname, ftype = parts[0], parts[1]
        attrs = " ".join(parts[2:])
        base = ftype.rstrip("?").rstrip("[]")
        if ftype.endswith("[]") or base in models:
            rel = re.search(r"@relation\(([^)]*)\)", attrs)
            if rel and "fields:" in rel.group(1):
                fields = re.search(r"fields: \[([^\]]*)\]", rel.group(1)).group(1).split(", ")
                od = re.search(r"onDelete: (\w+)", rel.group(1))
                fks.append((table, fields, models[base], od.group(1) if od else None, ftype.endswith("?")))
            continue
        m = re.search(r'@map\("(\w+)"\)', attrs)
        col = m.group(1) if m else fname
        colmap[fname] = col
        if base in enums:
            sqltype = f'"{base}"'
        elif "@db.Date" in attrs:
            sqltype = "DATE"
        else:
            sqltype = SCALAR[base]
        null = "" if ftype.endswith("?") else " NOT NULL"
        default = ""
        d = re.search(r"@default\((.*?)\)(\s|$)", attrs)
        if d:
            v = d.group(1)
            if v == "now()":
                default = " DEFAULT CURRENT_TIMESTAMP"
            elif v in ("uuid()", "cuid()"):
                default = ""
            elif v in ("true", "false") or re.fullmatch(r"-?\d+", v):
                default = f" DEFAULT {v}"
            elif v.startswith('"'):
                default = " DEFAULT '" + v.strip('"') + "'"
            else:
                default = f" DEFAULT '{v}'"
        cols.append(f'    "{col}" {sqltype}{null}{default}')
        if "@id" in attrs.split():
            pk = col
        if "@unique" in attrs.split():
            indexes.append(f'CREATE UNIQUE INDEX "{table}_{col}_key" ON "{table}"("{col}");')
    cols.append(f'\n    CONSTRAINT "{table}_pkey" PRIMARY KEY ("{pk}")')
    out.append(f'-- CreateTable\nCREATE TABLE "{table}" (\n' + ",\n".join(cols) + "\n);\n")
    for kind, fields in re.findall(r"@@(unique|index)\(\[([^\]]*)\]\)", body):
        dbcols = [colmap[f] for f in fields.split(", ")]
        suffix = "key" if kind == "unique" else "idx"
        uniq = "UNIQUE " if kind == "unique" else ""
        indexes.append(f'CREATE {uniq}INDEX "{table}_{"_".join(dbcols)}_{suffix}" ON "{table}"('
                       + ", ".join(f'"{c}"' for c in dbcols) + ");")
    models[model] = body  # keep
    globals().setdefault("COLMAPS", {})[table] = colmap

for table, fields, target_body, od, optional in fks:
    target = re.search(r'@@map\("(\w+)"\)', target_body).group(1)
    col = COLMAPS[table][fields[0]]
    action = ONDELETE[od] if od else ("SET NULL" if optional else "RESTRICT")
    fks_sql = (f'ALTER TABLE "{table}" ADD CONSTRAINT "{table}_{col}_fkey" FOREIGN KEY ("{col}") '
               f'REFERENCES "{target}"("id") ON DELETE {action} ON UPDATE CASCADE;')
    indexes.append("--FK--" + fks_sql)

print("\n".join(out))
for i in indexes:
    if not i.startswith("--FK--"):
        print("-- CreateIndex\n" + i + "\n")
for i in indexes:
    if i.startswith("--FK--"):
        print("-- AddForeignKey\n" + i[6:] + "\n")
