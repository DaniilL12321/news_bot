import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { News } from './news.entity';

@Entity('reactions')
export class Reaction {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  telegram_id: number;

  @Column()
  reaction_type: string;

  @ManyToOne(() => News, news => news.reactions)
  news: News;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;
} 