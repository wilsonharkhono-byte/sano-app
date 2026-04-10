ALTER TABLE purchase_order_lines
  ADD COLUMN IF NOT EXISTS scope_tag TEXT;

CREATE INDEX IF NOT EXISTS idx_po_lines_scope_tag
  ON purchase_order_lines(scope_tag)
  WHERE scope_tag IS NOT NULL;

UPDATE purchase_order_lines pol
SET scope_tag = CASE
  WHEN po.boq_ref IS NULL OR btrim(po.boq_ref) = '' THEN NULL
  WHEN upper(btrim(po.boq_ref)) = 'STOK UMUM' THEN 'STOK UMUM'
  WHEN po.boq_ref ~* '^MULTI-BOQ'
    THEN NULLIF(btrim(split_part(po.boq_ref, '·', 2)), '')
  ELSE btrim(po.boq_ref)
END
FROM purchase_orders po
WHERE po.id = pol.po_id
  AND pol.scope_tag IS NULL;
