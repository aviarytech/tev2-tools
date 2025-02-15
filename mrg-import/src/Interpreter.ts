// Read the SAF of the scope from which the MRG Importer is called.

import { log, report } from "@tno-terminology-design/utils"
import { glob } from "glob"

import { SAF, MRG, Scope, Terminology } from "@tno-terminology-design/utils"
import { download, writeFile } from "./Handler.js"

import os from "os"
import fs = require("fs")
import path = require("path")
import yaml = require("js-yaml")
import { AxiosError } from "axios"

/**
 * Initializes the MRG Importer.
 * @param scopedir The scopedir of the scope from which the MRG Importer is called.
 */
export async function initialize({ scopedir, prune }: { scopedir: string; prune: boolean }) {
  // read the SAF of the 'own' scope
  const env = new Interpreter({ scopedir: scopedir })
  const saf = await env.saf

  if (!saf.scopes) {
    log.warn(`No import scopes found in SAF at '${path.join(scopedir, "saf.yaml")}'`)
    return
  }

  if (prune) {
    await env.prune()
  }
  // for each scope in the scopes-section of the 'own' SAF
  // if saf.scopes.length > 0 then log.info with import scopes instead of scope
  log.info(
    `\x1b[1;37mFound ${saf.scopes.length} import scope${saf.scopes.length > 1 ? "s" : ""} in scopedir '${
      saf.scope.scopedir
    }'`
  )
  for (const scope of saf.scopes) {
    log.info(`\tHandling import scope '${scope.scopetag}'`)
    // read the SAF of the import scope
    const importEnv = new Interpreter({ scopedir: scope.scopedir })
    const importSaf = await importEnv.saf

    if (!importSaf.versions) {
      log.warn(`No maintained MRG files found in import scope '${scope.scopetag}'`)
      continue
    }

    // for each MRG file (version) in the import scope
    log.info(
      `\x1b[1;37mFound ${importSaf.versions.length} maintained MRG file${
        importSaf.versions.length > 1 ? "s" : ""
      } in import scope '${scope.scopetag}'`
    )
    for (const version of importSaf.versions) {
      try {
        // get MRG Map {import-scopedir}/{import-glossarydir}/mrg.{import-scopetag}.{import-vsntag}.yaml
        let mrgURL = path.join(
          scope.scopedir,
          importSaf.scope.glossarydir,
          `mrg.${importSaf.scope.scopetag}.${version.vsntag}.yaml`
        )
        const mrg = await importEnv.getMrgMap(mrgURL)

        // Set import MRG scopedir and scopetag values to the (non-relative) scope's scopedir and scopetag
        mrg.terminology.scopedir = scope.scopedir
        mrg.terminology.scopetag = scope.scopetag
        for (const entry of mrg.entries) {
          entry.scopetag = scope.scopetag
        }

        // write the contents to {my-scopedir}/{my-glossarydir}/mrg.{import-scopetag}.{import-vsntag}.yaml
        mrgURL = path.join(scopedir, saf.scope.glossarydir, `mrg.${scope.scopetag}.${version.vsntag}.yaml`)
        const mrgdump = yaml.dump(mrg, { forceQuotes: true, noRefs: true })
        writeFile(mrgURL, mrgdump)
        log.info(`\x1b[1;37m\tStoring MRG file '${path.basename(mrgURL)}' in '${path.dirname(mrgURL)}'`)

        if (version.altvsntags || version.vsntag === importSaf.scope.defaultvsn) {
          log.info(`\tCreating duplicates...`)
        }

        // if the version is the default version, create a duplicate {mrg.{import-scopetag}.yaml}
        if (version.vsntag === importSaf.scope.defaultvsn || version.altvsntags?.includes(importSaf.scope.defaultvsn)) {
          const defaultmrgURL = path.join(path.dirname(mrgURL), `mrg.${scope.scopetag}.yaml`)
          writeFile(defaultmrgURL, mrgdump)
          log.trace(`\t\t'${path.basename(defaultmrgURL)}' (default)`)
        }

        // Create a duplicate for every altvsntag
        if (typeof version.altvsntags === "string") {
          version.altvsntags = [version.altvsntags]
        }
        version.altvsntags?.forEach((altvsntag) => {
          const altmrgURL = path.join(path.dirname(mrgURL), `mrg.${scope.scopetag}.${altvsntag}.yaml`)
          writeFile(altmrgURL, mrgdump)
          log.trace(`\t\t'${path.basename(altmrgURL)}' (altvsn)`)
        })
      } catch (err) {
        report.onNotExistError(err as Error)
      }
    }
  }
}

/**
 * The Interpreter class, which handles the MRG and SAF objects.
 * @param scopedir The scopedir of the scope from which the MRG Importer is called.
 */
export class Interpreter {
  public scopedir: string
  public saf!: Promise<SAF>

  public constructor({ scopedir }: { scopedir: string }) {
    this.scopedir = scopedir

    this.saf = this.getSafMap(path.join(this.scopedir, "saf.yaml"))
  }

  /**
   * Retrieves the SAF (Scope Administration File) map.
   * @param safURL The URL of the SAF map.
   * @returns A promise that resolves to the SAF map.
   */
  private async getSafMap(safURL: string): Promise<SAF> {
    let saf = {} as SAF
    let safPath = safURL

    try {
      // If the `safURL` is a remote URL, download it to a temporary file
      try {
        const parsedURL = new URL(safURL)
        const tempPath = path.join(os.tmpdir(), `saf.yaml`)
        await download(parsedURL, tempPath)
        safPath = tempPath
      } catch (err) {
        if (err.message.includes("Invalid URL") || err.message.includes("Unsupported protocol")) {
          // `safURL` is not a valid URL, so assume it's a local path
        } else {
          // Handle other errors if needed
          throw err
        }
      }

      // Try to load the SAF map from the `safPath`
      const safContent = await fs.promises.readFile(safPath, "utf8")
      saf = yaml.load(safContent) as SAF

      saf.scope.localscopedir = path.dirname(safURL)

      // Check for missing required properties in SAF
      type ScopeProperty = keyof Scope
      const requiredProperties: ScopeProperty[] = ["scopetag", "scopedir", "curatedir"]
      const missingProperties = requiredProperties.filter((prop) => !saf.scope[prop])

      if (missingProperties.length > 0) {
        log.error(`E002 Missing required property in SAF at '${safURL}': '${missingProperties.join("', '")}'`)
        process.exit(1)
      }
    } catch (err) {
      if (err instanceof AxiosError && err.response) {
        log.error(`E004 SAF request of '${new URL(safURL)}' failed with status code ${err.response.status}`)
        process.exit(1)
      } else if (err instanceof yaml.YAMLException) {
        log.error(`E005 SAF interpretation of '${new URL(safURL)}' failed due to a YAML parsing error: ${err.message}`)
        process.exit(1)
      } else {
        // Handle other errors if needed
        throw err
      }
    }

    return saf
  }

  /**
   * Retrieves the MRG (Machine Readable Glossary) map.
   * @param mrgURL The URL of the MRG map.
   * @returns A promise that resolves to the MRG map.
   */
  public async getMrgMap(mrgURL: string): Promise<MRG> {
    let mrg = {} as Promise<MRG>
    let mrgPath = mrgURL

    // If the `mrgURL` is a remote URL, download it to a temporary file
    try {
      const parsedURL = new URL(mrgURL)
      const tempPath = path.join(os.tmpdir(), path.basename(mrgURL))
      await download(parsedURL, tempPath)
      mrgPath = tempPath
    } catch (err) {
      if (err instanceof TypeError && err.message.includes("Invalid URL")) {
        // `mrgURL` is not a valid URL, so assume it's a local path
      } else {
        // Handle other errors if needed
        throw err
      }
    }

    // Try to load the MRG map from the `mrgPath`
    const mrgfile = fs.readFileSync(mrgPath, "utf8")
    mrg = yaml.load(mrgfile) as Promise<MRG>

    // Check for missing required properties in MRG
    type TerminologyProperty = keyof Terminology
    const requiredProperties: TerminologyProperty[] = ["scopetag", "scopedir", "curatedir", "vsntag"]
    const terminology = (await mrg).terminology
    const missingProperties = requiredProperties.filter((prop) => !terminology[prop])

    if (missingProperties.length > 0) {
      throw new Error(`Missing required property in MRG at '${mrgURL}': '${missingProperties.join("', '")}'`)
    }

    return mrg
  }

  public async prune(): Promise<void> {
    log.info(`\x1b[1;37mPruning MRGs of scopes that are not in administered the SAF...`)
    const saf = await this.saf
    const glossaryfiles = path.join(saf.scope.localscopedir, saf.scope.glossarydir, `mrg.*.yaml`)
    // get all mrg files that match the glossaryfiles pattern
    const mrgfiles = await glob(glossaryfiles)

    for (const mrgfile of mrgfiles) {
      const basename = path.basename(mrgfile)
      // get the scopetag from the basename
      const scopetag = basename.match(/mrg.([a-z0-9_-]+)(?:.[a-z0-9_-]+)?.yaml/)?.[1]
      // if the scopetag is not in the SAF, delete the mrgfile
      if (
        scopetag != null &&
        !(saf.scopes?.find((scope) => scope.scopetag === scopetag) || scopetag === saf.scope.scopetag)
      ) {
        log.trace(`\tDeleting '${basename}'...`)
        fs.unlink(mrgfile, (err) => {
          if (err) {
            throw new Error(`Failed to delete '${basename}': ${err}`)
          }
        })
      }
    }
  }
}
