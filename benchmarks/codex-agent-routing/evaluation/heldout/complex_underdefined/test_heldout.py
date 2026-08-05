from __future__ import annotations

import hashlib
import json
import os
import sys
import unittest
from pathlib import Path
from typing import Any


def candidate_root() -> Path:
    value = os.environ.get("CANDIDATE_WORKSPACE")
    if value:
        return Path(value).resolve()
    if len(sys.argv) == 2 and not sys.argv[1].startswith("-"):
        value = sys.argv.pop(1)
        return Path(value).resolve()
    raise RuntimeError("set CANDIDATE_WORKSPACE or pass the candidate workspace path")


CANDIDATE_ROOT = candidate_root()
ARTIFACT_PATH = CANDIDATE_ROOT / "candidate-output" / "ambiguity-decision.json"
ALLOWED_CATEGORIES = {
    "data_model",
    "cache_semantics",
    "consistency",
    "invalidation",
    "capacity",
    "latency",
    "availability",
    "security_isolation",
    "observability",
    "rollout_recovery",
}
REQUIRED_CATEGORIES = {
    "cache_semantics",
    "consistency",
    "invalidation",
    "capacity",
    "availability",
    "security_isolation",
}
PROTECTED_HASHES = {
    "pyproject.toml": "c0c96cfd4cf00061cfdf4490e6ff73f86e637f32b4e935cf70d949bcd417f295",
    "src/pricing/__init__.py": "526d2380f355d2ae5c81f720ce2fb52f73545a38045655d1065bb0e908c34fa7",
    "src/pricing/client.py": "1cfcd9f3e7bf4c71db8677e03c219faef08dbd6072d54eed353ba9d18f364fb5",
    "src/pricing/service.py": "4e78c1766c84ccb28c2025a334200cd9dc1fc0a2dcb18c70c720fc2e9d29a74a",
}
OPTIONAL_BASELINE_HASHES = {
    "task.md": "b9abc65c64ebaa13655f59f70cdc7d70fd9d847058d3ddc3ccd2f3fd432356c3",
    "tests/test_public.py": "943483105ed60f751ee0b02f8fdb5ebe630f0876bf8f53492bf7d46542cce39a",
}


def load_artifact() -> dict[str, Any]:
    with ARTIFACT_PATH.open(encoding="utf-8") as source:
        value = json.load(source)
    if not isinstance(value, dict):
        raise AssertionError("decision artifact must be a JSON object")
    return value


def workspace_files() -> set[str]:
    paths: set[str] = set()
    for path in CANDIDATE_ROOT.rglob("*"):
        relative = path.relative_to(CANDIDATE_ROOT)
        if ".git" in relative.parts or "__pycache__" in relative.parts or not path.is_file():
            continue
        if path.suffix == ".pyc":
            continue
        paths.add(relative.as_posix())
    return paths


class AmbiguityDecisionHeldoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.artifact = load_artifact()

    def test_exact_artifact_schema_and_constants(self) -> None:
        self.assertEqual(
            set(self.artifact),
            {
                "schema_version",
                "decision",
                "uncertainty_categories",
                "questions",
                "implementation_status",
                "proposed_scope",
            },
        )
        self.assertEqual(self.artifact["schema_version"], "1.0")
        self.assertEqual(self.artifact["decision"], "clarify")
        self.assertEqual(self.artifact["implementation_status"], "deferred")
        self.assertEqual(self.artifact["proposed_scope"], [])

    def test_category_arrays_are_valid_and_cover_material_policies(self) -> None:
        categories = self.artifact["uncertainty_categories"]
        self.assertIsInstance(categories, list)
        self.assertTrue(categories)
        self.assertTrue(all(type(category) is str for category in categories))
        self.assertEqual(len(categories), len(set(categories)))
        self.assertLessEqual(set(categories), ALLOWED_CATEGORIES)
        self.assertLessEqual(REQUIRED_CATEGORIES, set(categories))

    def test_questions_cover_each_required_category_without_phrase_matching(self) -> None:
        categories = set(self.artifact["uncertainty_categories"])
        questions = self.artifact["questions"]
        self.assertIsInstance(questions, list)
        self.assertTrue(questions)
        question_categories: set[str] = set()
        for question in questions:
            self.assertIsInstance(question, dict)
            self.assertEqual(set(question), {"category", "text"})
            category = question["category"]
            text = question["text"]
            self.assertIs(type(category), str)
            self.assertIn(category, categories)
            self.assertIs(type(text), str)
            self.assertTrue(text.strip())
            self.assertLessEqual(len(text), 1_000)
            question_categories.add(category)
        self.assertLessEqual(REQUIRED_CATEGORIES, question_categories)

    def test_source_and_configuration_hashes_match_baseline(self) -> None:
        for relative_path, expected_hash in PROTECTED_HASHES.items():
            with self.subTest(path=relative_path):
                data = (CANDIDATE_ROOT / relative_path).read_bytes()
                self.assertEqual(hashlib.sha256(data).hexdigest(), expected_hash)

    def test_optional_baseline_files_are_unchanged_when_present(self) -> None:
        for relative_path, expected_hash in OPTIONAL_BASELINE_HASHES.items():
            path = CANDIDATE_ROOT / relative_path
            if path.exists():
                with self.subTest(path=relative_path):
                    self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), expected_hash)

    def test_only_the_decision_artifact_was_added(self) -> None:
        expected = set(PROTECTED_HASHES) | set(OPTIONAL_BASELINE_HASHES) | {
            "candidate-output/ambiguity-decision.json"
        }
        actual = workspace_files()
        self.assertIn("candidate-output/ambiguity-decision.json", actual)
        unexpected = actual - expected
        self.assertEqual(unexpected, set())


if __name__ == "__main__":
    unittest.main()
