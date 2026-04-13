from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, List

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, roc_auc_score
from sklearn.model_selection import GroupShuffleSplit
from sklearn.preprocessing import StandardScaler


FEATURE_NAMES = [
    "fixation_duration_ms",
    "regression_count",
    "saccade_speed_proxy",
    "line_skip_rate",
]


def _safe_float(value: object, default: float = 0.0) -> float:
    try:
        parsed = float(value)
        if np.isnan(parsed) or np.isinf(parsed):
            return default
        return parsed
    except (TypeError, ValueError):
        return default


def load_labels(label_file: Path) -> Dict[int, int]:
    df = pd.read_csv(label_file)
    labels: Dict[int, int] = {}
    for _, row in df.iterrows():
        sid = int(row["subject_id"])
        labels[sid] = int(row["class_id"])
    return labels


def build_training_table(metrics_dir: Path, labels: Dict[int, int]) -> pd.DataFrame:
    rows: List[dict] = []

    for metrics_file in sorted(metrics_dir.glob("Subject_*_metrics.csv")):
        try:
            df = pd.read_csv(metrics_file)
        except Exception:
            continue

        if df.empty:
            continue

        trial_row = df.iloc[0]
        sid = int(_safe_float(trial_row.get("sid"), -1))
        if sid not in labels:
            continue

        mean_fix_dur_trial = _safe_float(trial_row.get("mean_fix_dur_trial"))
        n_regress_trial = _safe_float(trial_row.get("n_regress_trial"))
        mean_sacc_ampl_trial = _safe_float(trial_row.get("mean_sacc_ampl_trial"))
        mean_sacc_dur_trial = _safe_float(trial_row.get("mean_sacc_dur_trial"), 1.0)
        n_between_line_regress_trial = _safe_float(trial_row.get("n_between_line_regress_trial"))
        n_sacc_trial = max(_safe_float(trial_row.get("n_sacc_trial"), 1.0), 1.0)

        saccade_speed_proxy = mean_sacc_ampl_trial / max(mean_sacc_dur_trial, 1e-6)
        line_skip_rate = n_between_line_regress_trial / n_sacc_trial

        rows.append(
            {
                "subject_id": sid,
                "fixation_duration_ms": mean_fix_dur_trial,
                "regression_count": n_regress_trial,
                "saccade_speed_proxy": saccade_speed_proxy,
                "line_skip_rate": line_skip_rate,
                "label": labels[sid],
                "source_file": metrics_file.name,
            }
        )

    return pd.DataFrame(rows)


def train_model(table: pd.DataFrame) -> dict:
    if table.empty:
        raise RuntimeError("No rows available for training.")

    x = table[FEATURE_NAMES].to_numpy(dtype=np.float64)
    y = table["label"].to_numpy(dtype=np.int64)
    groups = table["subject_id"].to_numpy(dtype=np.int64)

    splitter = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=42)
    train_idx, test_idx = next(splitter.split(x, y, groups=groups))

    x_train = x[train_idx]
    y_train = y[train_idx]
    x_test = x[test_idx]
    y_test = y[test_idx]

    scaler = StandardScaler()
    x_train_scaled = scaler.fit_transform(x_train)
    x_test_scaled = scaler.transform(x_test)

    model = LogisticRegression(max_iter=2000, class_weight="balanced", random_state=42)
    model.fit(x_train_scaled, y_train)

    train_prob = model.predict_proba(x_train_scaled)[:, 1]
    test_prob = model.predict_proba(x_test_scaled)[:, 1]

    train_pred = (train_prob >= 0.5).astype(np.int64)
    test_pred = (test_prob >= 0.5).astype(np.int64)

    train_metrics = {
        "accuracy": float(accuracy_score(y_train, train_pred)),
        "f1": float(f1_score(y_train, train_pred)),
        "roc_auc": float(roc_auc_score(y_train, train_prob)),
    }
    test_metrics = {
        "accuracy": float(accuracy_score(y_test, test_pred)),
        "f1": float(f1_score(y_test, test_pred)),
        "roc_auc": float(roc_auc_score(y_test, test_prob)),
    }

    feature_ranges = {}
    for idx, name in enumerate(FEATURE_NAMES):
        feature_ranges[name] = {
            "min": float(np.min(x[:, idx])),
            "max": float(np.max(x[:, idx])),
        }

    artifact = {
        "model_name": "etdd70_logreg_v0",
        "task": "dyslexia_proxy_probability",
        "feature_names": FEATURE_NAMES,
        "coefficients": model.coef_[0].tolist(),
        "intercept": float(model.intercept_[0]),
        "scaler_mean": scaler.mean_.tolist(),
        "scaler_scale": scaler.scale_.tolist(),
        "feature_ranges": feature_ranges,
        "metrics": {
            "train": train_metrics,
            "test": test_metrics,
        },
        "dataset": {
            "rows": int(len(table)),
            "subjects": int(table["subject_id"].nunique()),
            "train_rows": int(len(train_idx)),
            "test_rows": int(len(test_idx)),
            "positive_ratio": float(np.mean(y)),
        },
        "notes": [
            "Features map ETDD70 trial metrics to real-time proxies.",
            "Probability output is used as one signal in the live difficulty score.",
        ],
    }

    return artifact


def save_artifact(artifact: dict, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(artifact, indent=2), encoding="utf-8")


def main() -> None:
    script_dir = Path(__file__).resolve().parent
    default_dataset_root = script_dir.parent.parent / "13332134"
    default_output = script_dir / "artifacts" / "etdd70_logreg_v0.json"
    default_ui_output = script_dir.parent / "src" / "core" / "ai-engine" / "model" / "etdd70_logreg_v0.json"

    parser = argparse.ArgumentParser(description="Train ETDD70 logistic model and export JSON artifact.")
    parser.add_argument("--dataset-root", type=Path, default=default_dataset_root)
    parser.add_argument("--output", type=Path, default=default_output)
    parser.add_argument("--ui-output", type=Path, default=default_ui_output)
    args = parser.parse_args()

    label_file = args.dataset_root / "dyslexia_class_label.csv"
    metrics_dir = args.dataset_root / "data" / "data"

    if not label_file.exists():
        raise FileNotFoundError(f"Label file not found: {label_file}")
    if not metrics_dir.exists():
        raise FileNotFoundError(f"Metrics directory not found: {metrics_dir}")

    labels = load_labels(label_file)
    table = build_training_table(metrics_dir, labels)
    artifact = train_model(table)

    save_artifact(artifact, args.output)
    save_artifact(artifact, args.ui_output)

    print("Training complete.")
    print(f"Rows: {artifact['dataset']['rows']}, subjects: {artifact['dataset']['subjects']}")
    print(f"Test metrics: {artifact['metrics']['test']}")
    print(f"Saved artifact: {args.output}")
    print(f"Saved UI artifact: {args.ui_output}")


if __name__ == "__main__":
    main()
