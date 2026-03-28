"""Tests for the AAP Deployment Wizard CLI."""
import json
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

from app.cli import (
    create_parser,
    main,
    load_config,
    print_table,
    cmd_generate,
    cmd_validate,
    cmd_profiles,
    cmd_version,
    cmd_preflight,
    cmd_report,
)


class TestCLIParser:
    def test_generate_command(self):
        parser = create_parser()
        args = parser.parse_args(["generate", "--config", "config.json"])
        assert args.command == "generate"
        assert args.config == "config.json"

    def test_validate_command(self):
        parser = create_parser()
        args = parser.parse_args(["validate", "--config", "config.json"])
        assert args.command == "validate"
        assert args.config == "config.json"

    def test_preflight_command(self):
        parser = create_parser()
        args = parser.parse_args(["preflight", "--config", "config.json"])
        assert args.command == "preflight"
        assert args.config == "config.json"

    def test_profiles_list(self):
        parser = create_parser()
        args = parser.parse_args(["profiles", "list"])
        assert args.command == "profiles"
        assert args.profile_command == "list"

    def test_profiles_show(self):
        parser = create_parser()
        args = parser.parse_args(["profiles", "show", "production-ha"])
        assert args.command == "profiles"
        assert args.profile_command == "show"
        assert args.name == "production-ha"

    def test_profiles_export(self):
        parser = create_parser()
        args = parser.parse_args(["profiles", "export", "production-ha", "-o", "out.yaml"])
        assert args.command == "profiles"
        assert args.profile_command == "export"
        assert args.name == "production-ha"
        assert args.output == "out.yaml"

    def test_report_command(self):
        parser = create_parser()
        args = parser.parse_args(["report", "--config", "config.json", "--type", "pre-deploy"])
        assert args.command == "report"
        assert args.config == "config.json"
        assert args.type == "pre-deploy"

    def test_serve_command(self):
        parser = create_parser()
        args = parser.parse_args(["serve", "--port", "9000"])
        assert args.command == "serve"
        assert args.port == 9000

    def test_version_command(self):
        parser = create_parser()
        args = parser.parse_args(["version"])
        assert args.command == "version"

    def test_no_command_shows_help(self):
        parser = create_parser()
        args = parser.parse_args([])
        assert args.command is None


class TestLoadConfig:
    def test_load_json(self):
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            f.write(b'{"topology": "growth", "test": true}')
            f.flush()
            try:
                cfg = load_config(f.name)
                assert cfg["topology"] == "growth"
                assert cfg["test"] is True
            finally:
                Path(f.name).unlink()

    def test_load_yaml(self):
        with tempfile.NamedTemporaryFile(suffix=".yaml", delete=False) as f:
            f.write(b"topology: growth\ntest: true\n")
            f.flush()
            try:
                cfg = load_config(f.name)
                assert cfg["topology"] == "growth"
                assert cfg["test"] is True
            finally:
                Path(f.name).unlink()

    def test_load_nonexistent(self):
        with pytest.raises(FileNotFoundError):
            load_config("/nonexistent/path/config.json")

    def test_load_invalid_json(self):
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            f.write(b"{ invalid json }")
            f.flush()
            try:
                with pytest.raises(ValueError):
                    load_config(f.name)
            finally:
                Path(f.name).unlink()


class TestCLICommands:
    def test_version_output(self, capsys):
        class Args:
            pass

        args = Args()
        rc = cmd_version(args)
        assert rc == 0
        captured = capsys.readouterr()
        assert "AAP Deployment Wizard CLI" in captured.out
        assert "1.0.0" in captured.out

    def test_generate_from_config(self, default_config, tmp_path, capsys):
        config_path = tmp_path / "config.json"
        config_path.write_text(json.dumps(default_config))

        class Args:
            config = str(config_path)
            profile = None
            output = None
            format = "ini"
            dry_run = False

        rc = cmd_generate(Args())
        assert rc == 0
        captured = capsys.readouterr()
        assert "[automationgateway]" in captured.out
        assert "[automationcontroller]" in captured.out

    def test_generate_from_profile(self, capsys):
        class Args:
            config = None
            profile = "preset-growth-dev"
            output = None
            format = "ini"
            dry_run = True

        rc = cmd_generate(Args())
        assert rc == 0
        captured = capsys.readouterr()
        assert "[automationgateway]" in captured.out or "Note:" in captured.out or "inventory" in captured.out.lower()

    def test_generate_to_file(self, default_config, tmp_path, capsys):
        config_path = tmp_path / "config.json"
        config_path.write_text(json.dumps(default_config))
        out_path = tmp_path / "inventory.ini"

        class Args:
            config = str(config_path)
            profile = None
            output = str(out_path)
            format = "ini"
            dry_run = False

        rc = cmd_generate(Args())
        assert rc == 0
        assert out_path.exists()
        content = out_path.read_text()
        assert "[automationgateway]" in content

    def test_validate_valid_config(self, default_config, tmp_path, capsys):
        config_path = tmp_path / "config.json"
        config_path.write_text(json.dumps(default_config))

        class Args:
            config = str(config_path)
            strict = False
            json = False
            auto_fix = False

        rc = cmd_validate(Args())
        assert rc == 0
        captured = capsys.readouterr()
        assert "PASS" in captured.out or "score" in captured.out

    def test_validate_invalid_config(self, tmp_path, capsys):
        config_path = tmp_path / "config.json"
        config_path.write_text(json.dumps({"topology": "invalid", "gateway": {"hosts": []}}))

        class Args:
            config = str(config_path)
            strict = False
            json = False
            auto_fix = False

        rc = cmd_validate(Args())
        assert rc == 1

    def test_validate_strict_mode(self, default_config, tmp_path, capsys):
        config_path = tmp_path / "config.json"
        config_path.write_text(json.dumps(default_config))

        class Args:
            config = str(config_path)
            strict = True
            json = False
            auto_fix = False

        rc = cmd_validate(Args())
        assert rc in (0, 1)

    def test_validate_json_output(self, default_config, tmp_path, capsys):
        config_path = tmp_path / "config.json"
        config_path.write_text(json.dumps(default_config))

        class Args:
            config = str(config_path)
            strict = False
            json = True
            auto_fix = False

        rc = cmd_validate(Args())
        captured = capsys.readouterr()
        data = json.loads(captured.out)
        assert "valid" in data
        assert "score" in data

    def test_profiles_list(self, capsys):
        class Args:
            profile_command = "list"

        rc = cmd_profiles(Args())
        assert rc == 0
        captured = capsys.readouterr()
        assert "preset" in captured.out or "ID" in captured.out

    def test_profiles_show_preset(self, capsys):
        class Args:
            profile_command = "show"
            name = "preset-growth-dev"

        rc = cmd_profiles(Args())
        assert rc == 0
        captured = capsys.readouterr()
        assert "Growth" in captured.out or "preset-growth-dev" in captured.out

    def test_profiles_show_not_found(self, capsys):
        class Args:
            profile_command = "show"
            name = "nonexistent-profile-xyz"

        rc = cmd_profiles(Args())
        assert rc == 1
        captured = capsys.readouterr()
        assert "not found" in captured.out

    def test_report_config_type(self, default_config, tmp_path, capsys):
        config_path = tmp_path / "config.json"
        config_path.write_text(json.dumps(default_config))

        class Args:
            config = str(config_path)
            type = "config"
            format = "text"
            output = None

        rc = cmd_report(Args())
        assert rc == 0
        captured = capsys.readouterr()
        assert "Configuration" in captured.out or "Topology" in captured.out

    def test_preflight_with_config(self, default_config, tmp_path, capsys):
        config_path = tmp_path / "config.json"
        config_path.write_text(json.dumps(default_config))

        class Args:
            config = str(config_path)
            json = False
            fail_on_warning = False

        from app.models import PreflightResult, PreflightCheck

        async def mock_run(self):
            return PreflightResult(
                overall="passed",
                checks=[
                    PreflightCheck(name="OS", status="passed", message="RHEL 9.4"),
                    PreflightCheck(name="Python", status="passed", message="Python 3.12"),
                ],
            )

        with patch("app.cli.PreflightChecker.run", mock_run):
            rc = cmd_preflight(Args())
        assert rc == 0
        captured = capsys.readouterr()
        assert "PASSED" in captured.out or "passed" in captured.out


class TestPrintTable:
    def test_basic_table(self, capsys):
        print_table(["A", "B"], [["1", "2"], ["3", "4"]])
        captured = capsys.readouterr()
        assert "A" in captured.out
        assert "B" in captured.out
        assert "1" in captured.out
        assert "3" in captured.out

    def test_empty_table(self, capsys):
        print_table(["Col1"], [])
        captured = capsys.readouterr()
        assert "Col1" in captured.out

    def test_single_row(self, capsys):
        print_table(["X", "Y"], [["a", "b"]])
        captured = capsys.readouterr()
        assert "X" in captured.out
        assert "a" in captured.out
        assert "b" in captured.out


class TestMain:
    def test_main_no_args_returns_0(self):
        with patch("sys.argv", ["aap-wizard"]):
            rc = main()
        assert rc == 0

    def test_main_version(self):
        with patch("sys.argv", ["aap-wizard", "version"]):
            rc = main()
        assert rc == 0

    def test_main_invalid_config_exits_1(self):
        with patch("sys.argv", ["aap-wizard", "validate", "--config", "/nonexistent.json"]):
            rc = main()
        assert rc == 1
