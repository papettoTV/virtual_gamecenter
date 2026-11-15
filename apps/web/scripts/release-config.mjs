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
  if (environment === "staging" && !selected.analytics_engine_datasets?.some(item => item.binding === "SECURITY_EVENTS" && item.dataset === "pulbase_service_health")) errors.push("失効障害の検証環境専用集計バインディングが必要です。");
  if (environment === "production" && selected.analytics_engine_datasets?.some(item => item.dataset === "pulbase_service_health")) errors.push("本番から検証用の警告集計へ書き込めません。");
  if (!selected.durable_objects?.bindings?.some(item => item.name === "ABUSE_GUARDS" && item.class_name === "AbuseGuard" && !item.script_name)) errors.push("分散乱用対策は環境専用のAbuseGuardが必要です。");
  if (!config.migrations?.some(item => item.new_sqlite_classes?.includes("AbuseGuard"))) errors.push("分散乱用対策のSQLite移行が必要です。");
  if (selected.vars?.USAGE_MONITOR_ENABLED === "true") {
    if (environment !== "staging" || config.env?.production?.vars?.USAGE_MONITOR_ENABLED === "true") errors.push("アカウント監視は検証Workerの一箇所だけで実行してください。");
    if (selected.vars?.METRICS_ACCOUNT_ID !== config.account_id || !selected.secrets?.required?.includes("CLOUDFLARE_METRICS_TOKEN") || !selected.analytics_engine_datasets?.some(item => item.binding === "USAGE_METRICS" && item.dataset === "pulbase_account_usage") || !selected.triggers?.crons?.includes("0,15,30,45 * * * *")) errors.push("利用量監視の設定・Secret・15分Cronが不足しています。");
  }
  const rateNames = ["API_READ_LIMITER", "API_WRITE_LIMITER", "BOOTSTRAP_LIMITER", "BENEFIT_LIMITER", "SOCKET_LIMITER", "AUTH_LIMITER"];
  for (const name of rateNames) {
    const limiter = selected.ratelimits?.find(item => item.name === name);
    if (!limiter || !/^\d+$/.test(limiter.namespace_id) || limiter.simple?.period !== 60 || !Number.isInteger(limiter.simple?.limit) || limiter.simple.limit < 1) errors.push(`乱用対策${name}の設定が不足または不正です。`);
  }
  if (new Set(selected.ratelimits?.map(item => item.namespace_id)).size !== selected.ratelimits?.length) errors.push("乱用対策namespaceが重複しています。");
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
    if (selected.ratelimits?.some(item => other.ratelimits?.some(otherItem => otherItem.namespace_id === item.namespace_id))) errors.push("乱用対策namespaceが別環境と共用されています。");
    if (!selected.name || selected.name === other.name) errors.push("Worker名が別環境と重複しています。");
    const otherDatabase = binding(other, "DB", "d1_databases");
    if (database && otherDatabase && (database.database_id === otherDatabase.database_id || database.database_name === otherDatabase.database_name)) errors.push("D1が別環境と共用されています。");
    if (audit?.bucket_name && audit.bucket_name === binding(other, "DELETION_AUDIT", "r2_buckets")?.bucket_name) errors.push("削除証跡R2が別環境と共用されています。");
  }
  return [...new Set(errors)];
}

export function checkBuildConfig(config, selected, environment) {
  const errors = [];
  if (JSON.stringify(config.durable_objects) !== JSON.stringify(selected.durable_objects)) errors.push("成果物の分散乱用対策が選択した環境と一致しません。");
  if (config.vars?.USAGE_MONITOR_ENABLED !== selected.vars?.USAGE_MONITOR_ENABLED || config.vars?.METRICS_ACCOUNT_ID !== selected.vars?.METRICS_ACCOUNT_ID || JSON.stringify(config.analytics_engine_datasets) !== JSON.stringify(selected.analytics_engine_datasets)) errors.push("成果物の利用量監視が選択した環境と一致しません。");
  if (JSON.stringify(config.ratelimits) !== JSON.stringify(selected.ratelimits)) errors.push("成果物の乱用対策が選択した環境と一致しません。");
  if (config.name !== selected.name) errors.push("成果物のWorker名が選択した環境と一致しません。");
  if (config.vars?.APP_ENV !== environment || config.vars?.DEVELOPER_AUTH_ENABLED !== "false" || config.vars?.CREDIT_PURCHASES_ENABLED !== "false") errors.push("成果物の環境・認証・購入設定が不正です。");
  if (binding(config, "DB", "d1_databases")?.database_id !== binding(selected, "DB", "d1_databases")?.database_id) errors.push("成果物のD1が選択した環境と一致しません。");
  if (binding(config, "DELETION_AUDIT", "r2_buckets")?.bucket_name !== binding(selected, "DELETION_AUDIT", "r2_buckets")?.bucket_name) errors.push("成果物のR2が選択した環境と一致しません。");
  return errors;
}
