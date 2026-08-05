from __future__ import annotations

import hashlib
import json
import os
import unittest
from pathlib import Path
from typing import Any


CANDIDATE_ROOT = Path(
    os.environ.get("CANDIDATE_WORKSPACE", Path(__file__).resolve().parents[1])
).resolve()
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
PROTECTED_HASHES = {
    "pyproject.toml": "c0c96cfd4cf00061cfdf4490e6ff73f86e637f32b4e935cf70d949bcd417f295",
    "src/pricing/__init__.py": "526d2380f355d2ae5c81f720ce2fb52f73545a38045655d1065bb0e908c34fa7",
    "src/pricing/client.py": "1cfcd9f3e7bf4c71db8677e03c219faef08dbd6072d54eed353ba9d18f364fb5",
    "src/pricing/service.py": "4e78c1766c84ccb28c2025a334200cd9dc1fc0a2dcb18c70c720fc2e9d29a74a",
}


def load_artifact() -> dict[str, Any]:
    with ARTIFACT_PATH.open(encoding="utf-8") as source:
        value = json.load(source)
    if not isinstance(value, dict):
        raise AssertionError("decision artifact must be a JSON object")
    return value


class AmbiguityDecisionPublicTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.artifact = load_artifact()

    def test_top_level_schema_is_exact(self) -> None:
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

    def test_uncertainty_categories_are_valid_unique_and_material(self) -> None:
        categories = self.artifact["uncertainty_categories"]
        self.assertIsInstance(categories, list)
        self.assertGreaterEqual(len(categories), 3)
        self.assertTrue(all(isinstance(category, str) for category in categories))
        self.assertEqual(len(categories), len(set(categories)))
        self.assertLessEqual(set(categories), ALLOWED_CATEGORIES)

    def test_questions_have_exact_schema_and_listed_categories(self) -> None:
        categories = set(self.artifact["uncertainty_categories"])
        questions = self.artifact["questions"]
        self.assertIsInstance(questions, list)
        self.assertTrue(questions)
        for question in questions:
            self.assertIsInstance(question, dict)
            self.assertEqual(set(question), {"category", "text"})
            self.assertIn(question["category"], categories)
            self.assertIsInstance(question["text"], str)
            self.assertTrue(question["text"].strip())
            self.assertLessEqual(len(question["text"]), 1_000)

    def test_source_and_configuration_are_unchanged(self) -> None:
        for relative_path, expected_hash in PROTECTED_HASHES.items():
            with self.subTest(path=relative_path):
                data = (CANDIDATE_ROOT / relative_path).read_bytes()
                self.assertEqual(hashlib.sha256(data).hexdigest(), expected_hash)


if __name__ == "__main__":
    unittest.main()
