import { BaseCommand } from '../../core/libs/BaseCommand.js';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class SkillBaseCommand extends BaseCommand {
  constructor() {
    super();
    this.group = 'skill';
  }

  /**
   * Resuelve el directorio del agente (.agent, .claude, .qwen)
   */
  getAgentDir(agent = 'agent') {
    const agentDirMap = {
      'agent': '.agent',
      'claude': '.claude',
      'qwen': '.qwen'
    };
    return agentDirMap[agent] || `.${agent}`;
  }

  /**
   * Obtiene la lista de directorios de skills en un agente
   */
  async getSkillsDirectory(agentDir) {
    const skillsPath = path.join(agentDir, 'skills');
    try {
      const entries = await fs.readdir(skillsPath, { withFileTypes: true });
      return entries
        .filter(entry => entry.isDirectory())
        .map(entry => ({
          name: entry.name,
          path: path.join(skillsPath, entry.name)
        }));
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Parsea el frontmatter YAML de un archivo SKILL.md
   * Retorna { name, description, raw } o null si no hay header
   */
  async parseSkillFrontmatter(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');

      // Buscar bloques YAML entre --- (soporta LF y CRLF)
      const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---/;
      const match = content.match(frontmatterRegex);

      if (!match) {
        return null;
      }

      const frontmatterContent = match[1];
      const result = { raw: frontmatterContent };

      // Extraer name (trim CR si existe)
      const nameMatch = frontmatterContent.match(/^name:\s*(.+?)\r?$/m);
      result.name = nameMatch ? nameMatch[1].trim() : undefined;

      // Extraer description (trim CR si existe)
      const descMatch = frontmatterContent.match(/^description:\s*(.+?)\r?$/m);
      result.description = descMatch ? descMatch[1].trim() : undefined;
      
      return result;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Obtiene el tamaño de un archivo en KB
   */
  async getFileSizeKB(filePath) {
    try {
      const stats = await fs.stat(filePath);
      return (stats.size / 1024).toFixed(2);
    } catch (error) {
      return null;
    }
  }

  /**
   * Convierte un string a kebab-case
   */
  toKebabCase(str) {
    return str
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/\s+/g, '-')
      .toLowerCase();
  }

  /**
   * Verifica si un archivo existe
   */
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Asegura que un directorio exista, creándolo si es necesario
   */
  async ensureDirectoryExists(dirPath) {
    try {
      await fs.mkdir(dirPath, { recursive: true });
      this.log(`📁 Directorio creado: ${dirPath}`, 'success');
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
      this.log(`ℹ️ Directorio ya existe: ${dirPath}`, 'info');
    }
  }

  /**
   * Escribe un archivo, opcionalmente sobrescribiendo si existe
   */
  async writeFile(filePath, content, force = false) {
    if (await this.fileExists(filePath) && !force) {
      this.log(`⚠️ El archivo ya existe: ${filePath}`, 'warning');
      return false;
    }
    await fs.writeFile(filePath, content);
    this.log(`📄 Archivo creado: ${filePath}`, 'success');
    return true;
  }
}