export const releaseEnvironments = ["staging", "production"];

export function checkReleaseBranch(environment, branch) {
  const expected = { staging: "develop", production: "main" }[environment];
  return expected && branch === expected ? [] : [`${environment}の公開/リモート移行は${expected ?? "指定環境の"}ブランチから実施してください。`];
}

function binding(config, name, type) {
  return config?.[type]?.find((item) => item.binding === name);
}

export function checkReleaseConfig(config, environment) {
  if (!releaseEnvironments.includes(environment)) {
    return ["環境を明示してください: staging または production。既存の共通設定はデプロイ対象にしません。"];
  }
  const selected = config.env?.[environment];
  if (!selected) return [`${environment} の設定がありません。`];
  const errors = [];
  if (selected.workers_dev !== false || selected.routes?.length) errors.push("公開URLはPagesで管理します。バックエンドWorkerのworkers.devと公開routesを無効にしてください。");
  if (selected.vars?.APP_ENV !== environment) errors.push("APP_ENVが選択した環境と一致しません。");
  if (selected.vars?.DEVELOPER_AUTH_ENABLED !== "false") errors.push("公開先の開発者ログインはfalseが必要です。");
  if (selected.vars?.CREDIT_PURCHASES_ENABLED !== "false") errors.push("無料ベータでは購入停止が必要です。");
  if (selected.assets?.run_worker_first === false || config.assets?.run_worker_first !== true) errors.push("静的画面にも認証を適用するrun_worker_firstが必要です。");
  const required = selected.secrets?.required ?? [];
  for (const name of ["BASIC_AUTH_USERNAME", "BASIC_AUTH_PASSWORD", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) {
    if (!required.includes(name)) errors.push(`${name}の必須宣言がありません。`);
  }
  const database = binding(selected, "DB", "d1_databases");
  const audit = binding(selected, "DELETION_AUDIT", "r2_buckets");
  if (!database?.database_id || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(database.database_id)
    || database.database_id.startsWith("00000000-")) errors.push("D1の実際のdatabase_idを設定してください（未作成の仮IDは使用不可）。");
  if (database?.migrations_dir !== "migrations") errors.push("D1マイグレーションの参照先が不正です。");
  if (!audit?.bucket_name || audit.bucket_name.includes("replace")) errors.push("削除証跡用R2の設定が必要です。");
  if (!selected.durable_objects?.bindings?.some((item) => item.name === "CABINET_ROOMS" && item.class_name === "CabinetRoom" && !item.script_name)) errors.push("筐体はこの環境のDurable Objectへ接続してください。");
  if (!(selected.triggers ?? config.triggers)?.crons?.includes("0 * * * *")) errors.push("毎時の定期削除が必要です。");
  if ((selected.observability ?? config.observability)?.enabled !== true) errors.push("Worker監視を有効にしてください。");
  for (const name of Object.keys(selected.vars ?? {})) {
    if (/SECRET|PASSWORD|TOKEN|KEY/.test(name)) errors.push(`秘密情報${name}をvarsへ保存しないでください。`);
  }
  const others = [config, ...releaseEnvironments.filter((name) => name !== environment).map((name) => config.env?.[name]).filter(Boolean)];
  for (const other of others) {
    if (!selected.name || selected.name === other.name) errors.push("Worker名が別環境と重複しています。");
    const otherDatabase = binding(other, "DB", "d1_databases");
    if (database && otherDatabase && (database.database_id === otherDatabase.database_id || database.database_name === otherDatabase.database_name)) errors.push("D1が別環境と共用されています。");
    if (audit?.bucket_name && audit.bucket_name === binding(other, "DELETION_AUDIT", "r2_buckets")?.bucket_name) errors.push("削除証跡R2が別環境と共用されています。");
  }
  return [...new Set(errors)];
}

export function checkBuildConfig(config, selected, environment) {
  const errors = [];
  if (config.name !== selected.name) errors.push("成果物のWorker名が選択した環境と一致しません。");
  if (config.vars?.APP_ENV !== environment || config.vars?.DEVELOPER_AUTH_ENABLED !== "false" || config.vars?.CREDIT_PURCHASES_ENABLED !== "false") errors.push("成果物の環境・認証・購入設定が不正です。");
  if (binding(config, "DB", "d1_databases")?.database_id !== binding(selected, "DB", "d1_databases")?.database_id) errors.push("成果物のD1が選択した環境と一致しません。");
  if (binding(config, "DELETION_AUDIT", "r2_buckets")?.bucket_name !== binding(selected, "DELETION_AUDIT", "r2_buckets")?.bucket_name) errors.push("成果物のR2が選択した環境と一致しません。");
  return errors;
}
