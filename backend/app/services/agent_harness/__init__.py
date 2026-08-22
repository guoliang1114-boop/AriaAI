"""Aria-native agent harness primitives.

These modules are part of the AriaAI backend. They do not start, import, or
communicate with a Codex runtime. Selected algorithms are adapted from the
Apache-2.0-licensed open-source Codex repository; each adapted module records
its upstream source and local changes.

The package intentionally has no eager imports so low-level utilities such as
output buffering do not load chat policy or provider modules as a side effect.
"""
