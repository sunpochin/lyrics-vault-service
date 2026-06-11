/**
 * =====================================================================
 * 📜 Contract Validator — 零依賴的 JSON Schema 子集驗證器
 * =====================================================================
 * [技術] 驗證 contracts/lyrics-handoff.schema.json 所用到的 JSON Schema
 *        draft-07 子集：type（含 union）、required、properties、enum、
 *        items、minLength、minItems、definitions 內部 $ref。
 *        刻意不引入 ajv：契約規模小、子集明確，零依賴讓內建 mock
 *        與 verify 腳本維持「單獨 clone 即可執行」的特性。
 *        若姊妹 repo 想用 ajv 消費同一份 schema 檔，完全相容。
 * [童趣] 這是檢查「兩個服務交換包裹」的海關：包裹長什麼樣子寫在
 *        同一張公告（schema 檔）上，寄件方、收件方、檢查員都看同一張，
 *        誰偷偷改格式都會被當場抓到！
 * =====================================================================
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HANDOFF_SCHEMA_PATH = path.resolve(__dirname, '..', 'contracts', 'lyrics-handoff.schema.json');

/** 載入 handoff 契約 schema（單一事實來源檔案） */
export function loadHandoffSchema() {
  return JSON.parse(fs.readFileSync(HANDOFF_SCHEMA_PATH, 'utf-8'));
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function typeMatches(expected, value) {
  const actual = typeOf(value);
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  return actual === expected;
}

function resolveRef(ref, rootSchema) {
  if (!ref.startsWith('#/')) {
    throw new Error(`unsupported $ref (only internal refs allowed): ${ref}`);
  }
  let node = rootSchema;
  for (const segment of ref.slice(2).split('/')) {
    node = node?.[segment];
    if (node === undefined) {
      throw new Error(`unresolvable $ref: ${ref}`);
    }
  }
  return node;
}

function validateNode(schema, value, rootSchema, valuePath, errors) {
  if (schema.$ref) {
    validateNode(resolveRef(schema.$ref, rootSchema), value, rootSchema, valuePath, errors);
    return;
  }

  if (schema.enum) {
    if (!schema.enum.includes(value)) {
      errors.push(`${valuePath}: 值 ${JSON.stringify(value)} 不在允許清單 ${JSON.stringify(schema.enum)}`);
    }
    return;
  }

  if (schema.type) {
    const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!expectedTypes.some((t) => typeMatches(t, value))) {
      errors.push(`${valuePath}: 型別應為 ${expectedTypes.join('|')}，實際為 ${typeOf(value)}`);
      return; // 型別錯了，後續結構檢查沒有意義
    }
  }

  if (typeOf(value) === 'string' && schema.minLength !== undefined && value.length < schema.minLength) {
    errors.push(`${valuePath}: 字串長度需 >= ${schema.minLength}`);
  }

  if (typeOf(value) === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${valuePath}: 陣列長度需 >= ${schema.minItems}`);
    }
    if (schema.items) {
      value.forEach((item, index) => {
        validateNode(schema.items, item, rootSchema, `${valuePath}[${index}]`, errors);
      });
    }
  }

  if (typeOf(value) === 'object') {
    for (const requiredKey of schema.required ?? []) {
      if (!(requiredKey in value)) {
        errors.push(`${valuePath}: 缺少必要欄位 "${requiredKey}"`);
      }
    }
    for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
      if (key in value) {
        validateNode(propSchema, value[key], rootSchema, `${valuePath}.${key}`, errors);
      }
    }
  }
}

/**
 * 驗證資料是否符合 schema 中某個 definition。
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateAgainstDefinition(rootSchema, definitionName, value) {
  const definition = rootSchema.definitions?.[definitionName];
  if (!definition) {
    throw new Error(`schema 中不存在 definition: ${definitionName}`);
  }
  const errors = [];
  validateNode(definition, value, rootSchema, definitionName, errors);
  return { valid: errors.length === 0, errors };
}

/** 驗證失敗時直接丟出帶逐欄位明細的錯誤（fail-loud 用） */
export function assertMatchesDefinition(rootSchema, definitionName, value, context = '') {
  const { valid, errors } = validateAgainstDefinition(rootSchema, definitionName, value);
  if (!valid) {
    const prefix = context ? `${context} ` : '';
    throw new Error(`${prefix}違反 handoff 契約（${definitionName}）:\n  - ${errors.join('\n  - ')}`);
  }
}
