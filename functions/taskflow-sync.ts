import { base44 } from '@base44/sdk';

export default async function sync() {
  const startTime = Date.now();
  const sourceAppId = '69b637ecb1cf3b159d0c7496'; // TaskFlow
  
  try {
    // Fetch all tasks from TaskFlow
    const sourceTasks = await base44.entities('Task').list({ app_id: sourceAppId });
    const localTasks = await base44.entities('Task').list();
    
    const sourceMap = new Map(sourceTasks.records.map(t => [t.source_id || t.id, t]));
    const localMap = new Map(localTasks.records.map(t => [t.source_id || t.id, t]));
    
    let created = 0, updated = 0, skipped = 0;
    const errors: string[] = [];
    
    // Create or update tasks
    for (const sourceTask of sourceTasks.records) {
      const sourceId = sourceTask.source_id || sourceTask.id;
      const existing = localMap.get(sourceId);
      
      if (!existing) {
        // Create new task
        try {
          await base44.entities('Task').create({
            title: sourceTask.title,
            description: sourceTask.description || '',
            priority: sourceTask.priority || 'medium',
            status: sourceTask.status || 'todo',
            assigned_to: sourceTask.assigned_to || '',
            due_date: sourceTask.due_date,
            estimated_hours: sourceTask.estimated_hours,
            required_skills: sourceTask.required_skills || [],
            campaign: sourceTask.campaign || '',
            tags: sourceTask.tags || [],
            source_app: 'TaskFlow',
            source_id: sourceId,
            synced_at: new Date().toISOString(),
            ff_notes: sourceTask.ff_notes || '',
            ff_linked: sourceTask.ff_linked || false,
          });
          created++;
        } catch (e: any) {
          errors.push(`Create failed for "${sourceTask.title}": ${e.message}`);
          skipped++;
        }
      } else {
        // Check if changed
        const changed = 
          existing.status !== sourceTask.status ||
          existing.priority !== sourceTask.priority ||
          existing.assigned_to !== sourceTask.assigned_to ||
          existing.due_date !== sourceTask.due_date ||
          existing.title !== sourceTask.title;
        
        if (changed) {
          try {
            await base44.entities('Task').update(existing.id, {
              title: sourceTask.title,
              status: sourceTask.status || existing.status,
              priority: sourceTask.priority || existing.priority,
              assigned_to: sourceTask.assigned_to || existing.assigned_to,
              due_date: sourceTask.due_date || existing.due_date,
              estimated_hours: sourceTask.estimated_hours ?? existing.estimated_hours,
              campaign: sourceTask.campaign || existing.campaign,
              tags: sourceTask.tags || existing.tags,
              synced_at: new Date().toISOString(),
            });
            updated++;
          } catch (e: any) {
            errors.push(`Update failed for "${sourceTask.title}": ${e.message}`);
            skipped++;
          }
        } else {
          skipped++;
        }
      }
    }
    
    // Log sync
    const urgent = sourceTasks.records.filter(t => t.priority === 'urgent');
    const high = sourceTasks.records.filter(t => t.priority === 'high');
    
    const summary = `Pulled ${sourceTasks.records.length} tasks · created ${created}, updated ${updated}, skipped ${skipped}` +
      (urgent.length > 0 ? ` · ⚠️ ${urgent.length} URGENT` : '') +
      (high.length > 0 ? ` · 🔴 ${high.length} HIGH priority` : '');
    
    await base44.entities('SyncLog').create({
      sync_type: 'TaskFlow → timeX (auto)',
      source_app: 'TaskFlow',
      tasks_found: sourceTasks.records.length,
      tasks_created: created,
      tasks_updated: updated,
      tasks_skipped: skipped,
      errors: errors.length > 0 ? errors.join(' | ') : null,
      summary,
    });
    
    return {
      status: 'ok',
      duration_ms: Date.now() - startTime,
      tasks_found: sourceTasks.records.length,
      tasks_created: created,
      tasks_updated: updated,
      tasks_skipped: skipped,
      urgent_count: urgent.length,
      high_count: high.length,
      summary,
    };
  } catch (err: any) {
    return {
      status: 'error',
      error: err.message,
      duration_ms: Date.now() - startTime,
    };
  }
}
