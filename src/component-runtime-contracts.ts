import { z } from 'zod'
export const componentLibrarySchema=z.enum(['rune','tuffui'])
export const componentRuntimeInputSchema=z.strictObject({sessionId:z.string().min(1).max(200),library:componentLibrarySchema})
export const componentRuntimeInfoSchema=z.strictObject({
  protocolVersion:z.literal(1),library:componentLibrarySchema,
  sourceCommit:z.string().regex(/^[a-f0-9]{40}$/u),
  frameUrl:z.url().refine(value=>{const url=new URL(value);return url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!!url.port&&url.pathname.startsWith('/component-assets/')&&!url.username&&!url.password&&!url.search&&!url.hash},'COMPONENT_RUNTIME_URL_INVALID'),
})
export type ComponentRuntimeInfo=z.infer<typeof componentRuntimeInfoSchema>
export interface ComponentRuntimeApi {
  componentRuntimeInfo(input:z.infer<typeof componentRuntimeInputSchema>):Promise<ComponentRuntimeInfo>
  componentCatalog(input:z.infer<typeof componentRuntimeInputSchema>):Promise<z.infer<typeof componentCatalogResultSchema>>
  uiverseRuntimeComponent(input:z.infer<typeof uiverseRuntimeComponentInputSchema>):Promise<z.infer<typeof uiverseRuntimeComponentResultSchema>>
}
export const componentCatalogResultSchema=z.strictObject({library:z.literal('tuffui'),catalog:z.json(),typeSchemas:z.json()})
export const uiverseRuntimeComponentInputSchema=z.strictObject({sessionId:z.string().min(1).max(200),componentId:z.string().min(1).max(160),includeSharedCss:z.boolean().optional()})
export const uiverseRuntimeComponentResultSchema=z.strictObject({component:z.json(),sharedCss:z.string().max(8*1024*1024).optional()})
