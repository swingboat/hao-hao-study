-- Add Bedrock Converse as a first-class LLM provider protocol.
ALTER TYPE "LLMProtocol" ADD VALUE IF NOT EXISTS 'bedrock_converse';
