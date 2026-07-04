import { CreateScheduleDto } from './create-schedule.dto';

/**
 * PUT /payments/:paymentId/schedule body. Iteration 6.17.2.
 *
 * The PUT verb replaces the schedule wholesale (idempotent upsert), so the
 * payload shape is identical to the create body — declared as a subclass so
 * Swagger renders a separate schema and future divergence (e.g. an explicit
 * "clear nextRunAt" override on update) doesn't churn the create DTO.
 */
export class UpdateScheduleDto extends CreateScheduleDto {}
